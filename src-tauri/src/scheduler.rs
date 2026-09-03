use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter, Manager};

use crate::{state::AppState, try_refresh_accounts_shared};

const TICK: Duration = Duration::from_secs(5);

#[derive(Default)]
struct DueSchedule {
    due_at: HashMap<String, Instant>,
    generation: Option<u64>,
}

impl DueSchedule {
    fn sync(
        &mut self,
        generation: u64,
        account_ids: &[String],
        interval: Option<Duration>,
        now: Instant,
    ) {
        if self.generation != Some(generation) {
            self.generation = Some(generation);
            self.due_at.clear();
        }
        let Some(interval) = interval else {
            self.due_at.clear();
            return;
        };
        self.due_at.retain(|id, _| account_ids.contains(id));
        for account_id in account_ids {
            self.due_at
                .entry(account_id.clone())
                .or_insert_with(|| now + initial_delay(account_id, interval));
        }
    }

    fn next_due(&self, now: Instant) -> Option<String> {
        self.due_at
            .iter()
            .filter(|(_, due)| **due <= now)
            .min_by(|(left_id, left_due), (right_id, right_due)| {
                left_due.cmp(right_due).then_with(|| left_id.cmp(right_id))
            })
            .map(|(id, _)| id.clone())
    }

    fn mark_completed(&mut self, account_id: String, interval: Duration, now: Instant) {
        self.due_at.insert(account_id, now + interval);
    }
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut schedule = DueSchedule::default();
        let mut ticker = tokio::time::interval(TICK);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            ticker.tick().await;
            let state = app.state::<AppState>();
            if state.scheduler_stopped() {
                break;
            }
            let current_generation = state.scheduler_generation();
            let Ok(settings) = state.cursor_settings() else {
                continue;
            };
            if settings.auto_refresh_minutes <= 0 {
                schedule.sync(current_generation, &[], None, Instant::now());
                continue;
            }
            let interval = Duration::from_secs(settings.auto_refresh_minutes as u64 * 60);
            let Ok(accounts) = state.list() else {
                continue;
            };
            if accounts.is_empty() {
                schedule.sync(current_generation, &[], Some(interval), Instant::now());
                continue;
            }
            let now = Instant::now();
            let active_ids = accounts
                .iter()
                .map(|account| account.id.clone())
                .collect::<Vec<_>>();
            schedule.sync(current_generation, &active_ids, Some(interval), now);
            let Some(account_id) = schedule.next_due(now) else {
                continue;
            };
            if let Ok(results) = try_refresh_accounts_shared(&state, vec![account_id.clone()]).await
            {
                schedule.mark_completed(account_id, interval, Instant::now());
                let _ = app.emit("cursor-accounts-auto-refreshed", results);
            }
        }
    });
}

fn initial_delay(key: &str, interval: Duration) -> Duration {
    let interval_ms = interval.as_millis() as u64;
    let max = (interval_ms * 80 / 100).max(TICK.as_millis() as u64);
    let min = (interval_ms * 5 / 100)
        .max(TICK.as_millis() as u64)
        .min(max);
    if max <= min {
        return Duration::from_millis(min);
    }
    Duration::from_millis(min + stable_hash(key) % (max - min + 1))
}

fn stable_hash(value: &str) -> u64 {
    value.bytes().fold(0u64, |hash, byte| {
        hash.wrapping_mul(31).wrapping_add(byte as u64)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_delay_is_stable_and_staggered_inside_cockpit_window() {
        let interval = Duration::from_secs(600);
        let one = initial_delay("account-one", interval);
        let two = initial_delay("account-two", interval);
        assert_eq!(one, initial_delay("account-one", interval));
        assert_ne!(one, two);
        assert!(one >= Duration::from_secs(30));
        assert!(one <= Duration::from_secs(480));
    }

    #[test]
    fn disabled_or_empty_settings_leave_no_due_work() {
        let now = Instant::now();
        let mut schedule = DueSchedule::default();
        schedule.sync(0, &["one".to_owned()], Some(Duration::from_secs(120)), now);
        assert_eq!(schedule.due_at.len(), 1);

        schedule.sync(0, &[], None, now);
        assert!(schedule.due_at.is_empty());
        assert_eq!(schedule.next_due(now + Duration::from_secs(600)), None);
    }

    #[test]
    fn settings_generation_change_rebuilds_the_staggered_schedule() {
        let now = Instant::now();
        let account_ids = ["one".to_owned()];
        let mut schedule = DueSchedule::default();
        schedule.sync(0, &account_ids, Some(Duration::from_secs(600)), now);
        let original = schedule.due_at["one"];

        let changed_at = now + Duration::from_secs(10);
        schedule.sync(1, &account_ids, Some(Duration::from_secs(120)), changed_at);
        assert_ne!(schedule.due_at["one"], original);
        assert!(schedule.due_at["one"] > changed_at);
        assert!(schedule.due_at["one"] <= changed_at + Duration::from_secs(96));
    }

    #[test]
    fn due_work_uses_time_then_stable_key_and_retries_after_a_busy_skip() {
        let now = Instant::now();
        let mut schedule = DueSchedule {
            generation: Some(0),
            ..DueSchedule::default()
        };
        schedule.due_at.insert("zeta".to_owned(), now);
        schedule.due_at.insert("alpha".to_owned(), now);

        assert_eq!(schedule.next_due(now).as_deref(), Some("alpha"));
        assert_eq!(schedule.next_due(now).as_deref(), Some("alpha"));

        schedule.mark_completed("alpha".to_owned(), Duration::from_secs(120), now);
        assert_eq!(schedule.next_due(now).as_deref(), Some("zeta"));
        schedule.mark_completed("zeta".to_owned(), Duration::from_secs(120), now);
        assert_eq!(
            schedule.next_due(now + Duration::from_secs(120)).as_deref(),
            Some("alpha")
        );
    }
}
