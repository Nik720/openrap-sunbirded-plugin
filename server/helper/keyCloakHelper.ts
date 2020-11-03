import * as async from "async";
import * as Keycloak from "keycloak-connect";
let memoryStore = null;
import { logger } from "@project-sunbird/logger";
import * as session from "express-session";
import permissionsHelper from "./permissionsHelper";

const getKeyCloakClient = (config, store?) => {
  logger.debug("Keycloak getKeyCloakClient", config);
  const keycloak = new Keycloak({ store: store || memoryStore }, config);
  keycloak.authenticated = authenticated;
  keycloak.deauthenticated = deauthenticated;
  return keycloak;
};

const deauthenticated = (request) => {
  delete request.session.roles;
  delete request.session.rootOrgId;
  delete request.session.userId;
  if (request.session) {
    request.session.sessionEvents = request.session.sessionEvents || [];
    // telemetryHelper.logSessionEnd(request)
    delete request.session.sessionEvents;
  }
};

const authenticated = (request, next) => {
  logger.debug("keyclock authenticated method call");
  try {
    logger.debug("keyclock authenticated method call try");
    const userId = request.kauth.grant.access_token.content.sub.split(":");
    request.session.userId = userId[userId.length - 1];
  } catch (err) {
    logger.debug("userId conversation error", request.kauth.grant.access_token.content.sub, err);
  }
  const postLoginRequest = [];
  postLoginRequest.push((callback) => {
    permissionsHelper.getCurrentUserRoles(request, callback);
  });
  // if (JSON.parse(envHelper.sunbird_portal_updateLoginTimeEnabled || "false")) {
  //   postLoginRequest.push(function(callback) {
  //     userHelper.updateLoginTime(request, callback);
  //   });
  // }
  async.series(postLoginRequest, (err, results) => {
    // telemetryHelper.logSessionStart(request);
    if (err) {
      logger.error({msg: "error loggin in user", error: err});
      next(err, null);
    } else {
      logger.info({msg: "keycloack authenticated successfully"});
      next(null, "loggedin");
    }
  });
};

const memoryType = process.env.PORTAL_SESSION_STORE_TYPE;
switch (memoryType) {
  case "in-memory":
    memoryStore = new session.MemoryStore();
    break;
  // case "pouchdb":
  //   memoryStore = cassandraUtils.getCassandraStoreInstance();
  //   break;
  // case "redis":
  //   const redisUtils = require("./redisUtil");
  //   memoryStore = redisUtils.getRedisStoreInstance(session);
  //   break;
  // default:
  //   memoryStore = cassandraUtils.getCassandraStoreInstance();
  //   break;
}

export {
  getKeyCloakClient,
  memoryStore,
};
