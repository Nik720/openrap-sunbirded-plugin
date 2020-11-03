import { logger } from "@project-sunbird/logger";
import * as jwt from "jsonwebtoken";
import * as keyCloakAuthUtils from "keycloak-auth-utils";
import { Token } from "keycloak-auth-utils/lib/token.js";

export default class ApiInterceptor {

    private config;
    private keyCloakConfig;
    private grantManager;
    private validIssuers;
    private useKidBasedValidation = false;
    private kidToPublicKeyMap = {};

    constructor(keyclockConfig, cacheConfig, validIssuers) {
        this.config = keyclockConfig;
        this.keyCloakConfig = new keyCloakAuthUtils.Config(this.config);
        this.grantManager = new keyCloakAuthUtils.GrantManager(this.keyCloakConfig);
        this.validIssuers = validIssuers;
    }

    /**
     * [validateToken is used for validate user]
     * @param  {[string]}   token    [x-auth-token]
     * @param  {Function} cb []
     * @return {[Function]} callback [its retrun err or object with fields(token, userId)]
     */
    public validateToken =  (token, cb) => {
        if (!this.useKidBasedValidation) {
            return this.grantManager.validateToken(new Token(token))
            .then((userData: { content: string; }) => cb(null, { token, userId: userData.content.sub }))
            .catch((err: any) => cb(err, null));
        }
        const decoded: any = jwt.decode(token, {complete: true});
        if (!decoded) {
            logger.error("invalid jwt token - 401");
            return cb("INVALID_JWT");
        }
        const publicKey = this.kidToPublicKeyMap[decoded.header.kid];
        if (!publicKey) {
            logger.error("invalid kid - 401");
            return cb("INVALID_KID");
        }
        const verificationOption = {
            ignoreExpiration: false, // verify expiry time also
            // ignoreNotBefore: false, // verify not before also
            issuer: this.validIssuers ? this.validIssuers : "",
        };
        jwt.verify(token, publicKey, verificationOption, (err, payload: any) => {
            if (err) {
                logger.error("invalid signature - 401", err);
                return cb("INVALID_SIGNATURE");
            }
            cb(null, { token, userId: payload.sub });
        });
    }
}
