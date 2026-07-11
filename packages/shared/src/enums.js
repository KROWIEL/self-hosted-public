"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PowerAction = exports.DeployStatus = exports.ServiceStatus = exports.ServiceType = exports.GitProvider = exports.NodeStatus = exports.Role = void 0;
var Role;
(function (Role) {
    Role["ADMIN"] = "ADMIN";
    Role["USER"] = "USER";
})(Role || (exports.Role = Role = {}));
var NodeStatus;
(function (NodeStatus) {
    NodeStatus["ONLINE"] = "ONLINE";
    NodeStatus["OFFLINE"] = "OFFLINE";
})(NodeStatus || (exports.NodeStatus = NodeStatus = {}));
var GitProvider;
(function (GitProvider) {
    GitProvider["GITHUB"] = "GITHUB";
    GitProvider["GITLAB"] = "GITLAB";
})(GitProvider || (exports.GitProvider = GitProvider = {}));
var ServiceType;
(function (ServiceType) {
    ServiceType["BACKEND"] = "BACKEND";
    ServiceType["FRONTEND"] = "FRONTEND";
})(ServiceType || (exports.ServiceType = ServiceType = {}));
var ServiceStatus;
(function (ServiceStatus) {
    ServiceStatus["CREATED"] = "CREATED";
    ServiceStatus["BUILDING"] = "BUILDING";
    ServiceStatus["RUNNING"] = "RUNNING";
    ServiceStatus["STOPPED"] = "STOPPED";
    ServiceStatus["ERROR"] = "ERROR";
})(ServiceStatus || (exports.ServiceStatus = ServiceStatus = {}));
var DeployStatus;
(function (DeployStatus) {
    DeployStatus["QUEUED"] = "QUEUED";
    DeployStatus["BUILDING"] = "BUILDING";
    DeployStatus["DEPLOYING"] = "DEPLOYING";
    DeployStatus["SUCCESS"] = "SUCCESS";
    DeployStatus["FAILED"] = "FAILED";
})(DeployStatus || (exports.DeployStatus = DeployStatus = {}));
var PowerAction;
(function (PowerAction) {
    PowerAction["START"] = "start";
    PowerAction["STOP"] = "stop";
    PowerAction["RESTART"] = "restart";
    PowerAction["KILL"] = "kill";
})(PowerAction || (exports.PowerAction = PowerAction = {}));
