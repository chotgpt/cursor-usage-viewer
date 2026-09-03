use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter, Manager};

use crate::{state::AppState, try_refresh_accounts_shared};

const TICK: Duration = Duration::from_secs(5);

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut due_at: HashMap<String, Instant> = HashMap::new();
        let mut generation = u64::MAX;
        let mut ticker = tokio::time::interval(TICK);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            ticker.tick().await;
            let state = app.state::<AppState>();
            if state.scheduler_stopped() {
                break;
            }
            let current_generation = state.scheduler_generation();
            if generation != current_generation {
                generation = current_generation;
                due_at.clear();
            }
            let Ok(settings) = state.cursor_settings() else {
                continue;
            };
            if settings.auto_refresh_minutes <= 0 {
                due_at.clear();
                continue;
            }
            let interval = Duration::from_secs(settings.auto_refresh_minutes as u64 * 60);
            let Ok(accounts) = state.list() else {
                continue;
            };
            if accounts.is_empty() {
                due_at.clear();
                continue;
            }
            let now = Instant::now();
            let active_ids = accounts
                .iter()
                .map(|account| account.id.as_str())
                .collect::<Vec<_>>();
            due_at.retain(|id, _| active_ids.contains(&id.as_str()));
            for account in &accounts {
                due_at
                    .entry(account.id.clone())
                    .or_insert_with(|| now + initial_delay(&account.id, interval));
            }

            let next = due_at
                .iter()
                .filter(|(_, due)| **due <= now)
                .min_by(|(left_id, left_due), (right_id, right_due)| {
                    left_due.cmp(right_due).then_with(|| left_id.cmp(right_id))
                })
                .map(|(id, _)| id.clone());
            let Some(account_id) = next else {
                continue;
            };
            if let Ok(results) = try_refresh_accounts_shared(&state, vec![account_id.clone()]).await
            {
                due_at.insert(account_id, Instant::now() + interval);
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
}
