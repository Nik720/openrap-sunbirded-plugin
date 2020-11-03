/**
 * @file
 * @description - Permission helper handler
 * @version 1.0
 */

import * as dateFormat from "dateformat";
import * as _ from "lodash";
import * as request from "request";
import uuid = require("uuid");
const learnerURL            = process.env.LEARNER_URL;
const apiAuthToken          = process.env.PORTAL_API_AUTH_TOKEN;
import { logger } from "@project-sunbird/logger";

const PERMISSIONS_HELPER = {

  /**
   * @param  {Object} reqObj          - Request object
   * @param  {Object} body            - User read API response object
   * @description setUserSessionData  - Set user session details
   */
  setUserSessionData(reqObj, body) {
    try {
      if (body.responseCode === "OK") {
        reqObj.session.userId = body.result.response.identifier;
        if (body.result.response.managedBy) {
          reqObj.session.userSid = uuid();
        } else {
          reqObj.session.userSid = reqObj.sessionID;
        }
        if (body.result.response.managedToken) {
          reqObj.session.managedToken = body.result.response.managedToken;
        }
        reqObj.session.roles = body.result.response.roles;
        if (body.result.response.organisations) {
          _.forEach(body.result.response.organisations, (org) => {
            if (org.roles && _.isArray(org.roles)) {
              reqObj.session.roles = _.union(reqObj.session.roles, org.roles);
            }
            if (org.organisationId) {
              reqObj.session.orgs.push(org.organisationId);
            }
          });
        }
        reqObj.session.orgs = _.uniq(reqObj.session.orgs);
        reqObj.session.orgs = _.compact(reqObj.session.orgs);
        reqObj.session.roles = _.uniq(reqObj.session.roles);
        if (body.result.response.rootOrg && body.result.response.rootOrg.id) {
          reqObj.session.rootOrgId = body.result.response.rootOrg.id;
          reqObj.session.rootOrghashTagId = body.result.response.rootOrg.hashTagId;
          reqObj.session.rootOrg = body.result.response.rootOrg;
        }
        // For bulk upload user(s); `PUBLIC` role added.
        if (!_.includes(reqObj.session.roles, "PUBLIC")) {
          reqObj.session.roles.push("PUBLIC");
        }
      }
    } catch (e) {
      logger.error({msg: "setUserSessionData :: Error while saving user session data", err: e});
    }
  },

  /**
   * @param  {Object} reqObj          - Request object
   * @param  {Callback} callback      - Callback
   * @param  {String} userIdentifier  - User identifier
   * @param  {Boolean} isManagedUser  - Flag to indicate isManagedUser
   * @description getCurrentUserRoles - Function to get user roles
   */
  getCurrentUserRoles(reqObj, callback, userIdentifier?, isManagedUser?) {
    const userId = userIdentifier || reqObj.session.userId;
    let url = learnerURL + "user/v1/read/" + userId;
    if (isManagedUser) {
      url = url + "?withTokens=true";
    }
    const options = {
      method: "GET",
      url,
      headers: {
        "x-msgid": uuid(),
        "ts": dateFormat(new Date(), "yyyy-mm-dd HH:MM:ss:lo"),
        "content-type": "application/json",
        "accept": "application/json",
        "Authorization": "Bearer " + apiAuthToken,
        "x-authenticated-user-token": reqObj.kauth.grant.access_token.token,
      },
      json: true,
    };
    const telemetryData = {
      reqObj,
      options,
      uri: "user/v1/read",
      type: "user",
      id: userId,
      userId,
    };
    request(options, (error, response, body) => {
      // telemetryData.statusCode = _.get(response, "statusCode");
      reqObj.session.roles = [];
      reqObj.session.orgs = [];
      if (error) {
        logger.error({ msg: "error while user/v1/read", error });
        callback(error, null);
      } else if (!error && body && body.responseCode === "OK") {
        this.setUserSessionData(reqObj, body);
        const sessionLog = {
          userId: reqObj.session.userId || null,
          rootOrgId: reqObj.session.rootOrgId || null,
          roles: reqObj.session.roles || null,
          userSid: reqObj.session.userSid || null,
          orgs: reqObj.session.orgs || null,
        };
        logger.info({ msg: "getCurrentUserRoles :: Session data set success", session: sessionLog });
        reqObj.session.save((err: any) => {
          if (err) {
            callback(err, null);
          } else {
            callback(null, body);
          }
        });
      } else if (body.responseCode !== "OK") {
        logger.error({ msg: "getCurrentUserRoles :: Error while reading user/v1/read", body });
        callback(body, null);
      } else {
        logger.error({ msg: "getCurrentUserRoles error while user/v1/read", error });
        callback(error, null);
      }
    });
  },
};
export default PERMISSIONS_HELPER;
