use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("找不到 APPDATA，无法定位 Cursor 数据库")]
    AppDataUnavailable,
    #[error("Cursor 数据库不存在：{0}")]
    DatabaseMissing(String),
    #[error("无法只读打开 Cursor 数据库：{0}")]
    DatabaseOpen(String),
    #[error("读取 Cursor 数据库失败：{0}")]
    DatabaseRead(String),
    #[error("当前 Cursor 账号没有可用的 Access Token")]
    AccessTokenMissing,
    #[error("敏感状态锁不可用")]
    StateUnavailable,
    #[error("网络 Provider 初始化失败：{0}")]
    ProviderInit(String),
    #[error("请求目标未通过固定白名单")]
    EndpointRejected,
    #[error("Access Token 不能安全地写入请求头")]
    InvalidCredentialHeader,
    #[error("Cursor Access Token 不是可识别的会话 JWT")]
    InvalidSessionToken,
    #[error("Cursor 官方端点请求失败：{0}")]
    Request(String),
    #[error("Cursor 响应超过安全大小限制")]
    ResponseTooLarge,
    #[error("Cursor 返回了无法解析的 JSON（HTTP {0}）")]
    InvalidJson(u16),
    #[error("Cursor 官方端点返回了 HTTP {0}")]
    UnexpectedStatus(u16),
    #[error("粘贴的 Cockpit Tools JSON 超过 8 MiB 安全限制")]
    ImportJsonTooLarge,
    #[error("Cockpit Tools JSON 格式无效")]
    ImportJsonInvalid,
    #[error("Cockpit Tools 导入账号过多，最多允许 500 个")]
    ImportAccountLimit,
    #[error("第 {index} 个 Cockpit Tools 账号无效：{reason}")]
    ImportAccountInvalid { index: usize, reason: &'static str },
    #[error("找不到所选账号")]
    AccountNotFound,
}

pub type AppResult<T> = Result<T, AppError>;
