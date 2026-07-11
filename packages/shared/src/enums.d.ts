export declare enum Role {
    ADMIN = "ADMIN",
    USER = "USER"
}
export declare enum NodeStatus {
    ONLINE = "ONLINE",
    OFFLINE = "OFFLINE"
}
export declare enum GitProvider {
    GITHUB = "GITHUB",
    GITLAB = "GITLAB"
}
export declare enum ServiceType {
    BACKEND = "BACKEND",
    FRONTEND = "FRONTEND"
}
export declare enum ServiceStatus {
    CREATED = "CREATED",
    BUILDING = "BUILDING",
    RUNNING = "RUNNING",
    STOPPED = "STOPPED",
    ERROR = "ERROR"
}
export declare enum DeployStatus {
    QUEUED = "QUEUED",
    BUILDING = "BUILDING",
    DEPLOYING = "DEPLOYING",
    SUCCESS = "SUCCESS",
    FAILED = "FAILED"
}
export declare enum PowerAction {
    START = "start",
    STOP = "stop",
    RESTART = "restart",
    KILL = "kill"
}
