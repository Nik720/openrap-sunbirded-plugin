import { Inject } from "typescript-ioc";
import DatabaseSDK from "../../sdk/database";
import * as _ from "lodash";
import config from "../../config";
import Response from "../../utils/response";
import { Manifest } from "@project-sunbird/ext-framework-server/models";
import * as Busboy from "busboy";
import * as fs from "fs";
import { logger } from "@project-sunbird/ext-framework-server/logger";
import * as path from "path";
import ContentManager from "../../manager/ContentManager";
import { ContentImportManager } from "../../manager/contentImportManager"
import * as uuid from "uuid";
import Hashids from "hashids";
import { containerAPI } from "OpenRAP/dist/api";
import * as TreeModel from "tree-model";
import { HTTPService } from "@project-sunbird/ext-framework-server/services";

export enum DOWNLOAD_STATUS {
    SUBMITTED = "DOWNLOADING",
    COMPLETED = "DOWNLOADING",
    EXTRACTED = "DOWNLOADING",
    INDEXED = "DOWNLOADED",
    FAILED = "FAILED"
}
const INTERVAL_TO_CHECKUPDATE = 1
export default class Content {
    private contentsFilesPath: string = 'content';
    private ecarsFolderPath: string = 'ecars';
    @Inject
    private databaseSdk: DatabaseSDK;

    @Inject
    private contentManager: ContentManager;

    @Inject
    private contentImportManager: ContentImportManager;

    private fileSDK;

    constructor(manifest: Manifest) {
        this.databaseSdk.initialize(manifest.id);
        this.fileSDK = containerAPI.getFileSDKInstance(manifest.id);
        this.contentManager.initialize(
            manifest.id,
            this.fileSDK.getAbsPath(this.contentsFilesPath),
            this.fileSDK.getAbsPath(this.ecarsFolderPath)
        );
        this.contentImportManager.initialize(
            manifest.id,
            this.fileSDK.getAbsPath(this.contentsFilesPath),
            this.fileSDK.getAbsPath(this.ecarsFolderPath)
        );
    }

    searchInDB(filters, reqId, sort?) {
        logger.debug(`ReqId = "${reqId}": Contents are searching in ContentDb with given filters`)
        let modifiedFilters: Object = _.mapValues(filters, (v, k) => {
            if (k !== 'query') return ({ '$in': v })
        });
        delete modifiedFilters['query'];
        logger.info(`ReqId = "${reqId}": Deleted 'query' in modifiedFilters`);
        if (_.get(filters, 'query')) {
            modifiedFilters['name'] = {
                "$regex": new RegExp(_.get(filters, 'query'), 'i')
            }
        }
        modifiedFilters['visibility'] = 'Default';
        let dbFilters = {
            selector: modifiedFilters,
            limit: parseInt(config.get('CONTENT_SEARCH_LIMIT'), 10)
        }
        if (sort) {
            logger.info(`ReqId = "${reqId}": Sort is present. Sorting the contents based on given sort properties`)
            for (let sortFields of Object.keys(sort)) {
                dbFilters.selector[sortFields] = {
                    "$gt": null
                }
            }
            dbFilters['sort'] = [sort];
        }
        logger.debug(`ReqId = "${reqId}": Find the contents in ContentDb with the given filters`)
        return this.databaseSdk.find('content', dbFilters);
    }

    get(req: any, res: any): any {
        (async () => {
            try {
                logger.debug(`ReqId = "${req.headers['X-msgid']}": Called Content get method to get Content: ${req.params.id} `);
                let id = req.params.id;
                logger.debug(`ReqId = "${req.headers['X-msgid']}": Get Content: ${id} from ContentDB`);
                let content = await this.databaseSdk.get('content', id);
                content = _.omit(content, ['_id', '_rev']);
                let resObj = {};
                logger.debug(`ReqId = "${req.headers['X-msgid']}": Call isUpdateRequired()`)
                if (this.isUpdateRequired(content, req)) {
                    logger.debug(`ReqId = "${req.headers['X-msgid']}": Call checkForUpdate() to check whether update is required for content: `, _.get(content, 'identifier'));
                    content = await this.checkForUpdates(content, req)
                    resObj['content'] = content;
                    return res.send(Response.success('api.content.read', resObj, req));
                } else {
                    resObj['content'] = content;
                    return res.send(Response.success('api.content.read', resObj, req));
                }
            } catch (error) {
                logger.error(
                    `ReqId = "${req.headers['X-msgid']}": Received error while getting the data from content database and err.message: ${error}`
                );
                if (error.status === 404) {
                    res.status(404);
                    return res.send(Response.error('api.content.read', 404));
                } else {
                    let status = error.status || 500;
                    res.status(status);
                    return res.send(Response.error('api.content.read', status));
                }
            }
        })()

    }

    search(req: any, res: any): any {
        logger.debug(`ReqId = "${req.headers['X-msgid']}": Called content search method`);
        let reqBody = req.body;
        let pageReqFilter = _.get(reqBody, 'request.filters');
        let contentSearchFields = config.get('CONTENT_SEARCH_FIELDS').split(',');
        logger.info(`ReqId = "${req.headers['X-msgid']}": picked filters from the request`);
        let filters = _.pick(pageReqFilter, contentSearchFields);
        filters = _.mapValues(filters, function (v) {
            return _.isString(v) ? [v] : v;
        });
        let query = _.get(reqBody, 'request.query');
        if (!_.isEmpty(query)) {
            filters.query = query;
        }
        logger.info(`ReqId = "${req.headers['X-msgid']}": Got query from the request`);
        logger.debug(`ReqId = "${req.headers['X-msgid']}": Searching Content in Db with given filters`)
        this.searchInDB(filters, req.headers['X-msgid'])
            .then(data => {
                data = _.map(data.docs, doc => _.omit(doc, ['_id', '_rev']));
                let resObj = {};
                if (data.length === 0) {
                    logger.info(`ReqId = "${req.headers['X-msgid']}": Contents NOT found in DB`);
                    resObj = {
                        content: [],
                        count: 0
                    };
                } else {
                    logger.info(`ReqId = "${req.headers['X-msgid']}": Contents = ${data.length} found in DB`)
                    resObj = {
                        content: data,
                        count: data.length
                    };
                }

                return res.send(Response.success('api.content.search', resObj, req));
            })
            .catch(err => {
                console.log(err);
                logger.error(
                    `ReqId = "${req.headers['X-msgid']}":  Received error while searching content - err.message: ${
                    err.message
                    } ${err}`
                );
                if (err.status === 404) {
                    res.status(404);
                    return res.send(Response.error('api.content.search', 404));
                } else {
                    let status = err.status || 500;
                    res.status(status);
                    return res.send(Response.error('api.content.search', status));
                }
            });
    }

    async importV2(req: any, res: any) {
        const ecarFilePaths = req.body
        if (!ecarFilePaths) {
            return res.status(400).send(Response.error(`api.content.import`, 400, "MISSING_ECAR_PATH"));
        }
        this.contentImportManager.registerImportJob(ecarFilePaths).then(jobIds => {
            res.send(Response.success('api.content.import', {
                importedJobIds: jobIds
            }, req))
        }).catch(err => {
            res.status(500);
            res.send(Response.error(`api.content.import`, 400, err.errMessage || err.message, err.code))
        });
    }
    async pauseImport(req: any, res: any) {
        this.contentImportManager.pauseImport(req.params.importId).then(jobIds => {
            res.send(Response.success('api.content.import', {
                jobIds
            }, req))
        }).catch(err => {
            res.status(500);
            res.send(Response.error(`api.content.import`, 400, err.message))
        });
    }
    async resumeImport(req: any, res: any) {
        this.contentImportManager.resumeImport(req.params.importId).then(jobIds => {
            res.send(Response.success('api.content.import', {
                jobIds
            }, req))
        }).catch(err => {
            res.status(500);
            res.send(Response.error(`api.content.import`, 400, err.message))
        });;
    }
    async cancelImport(req: any, res: any) {
        await this.contentImportManager.cancelImport(req.params.importId).then(jobIds => {
            res.send(Response.success('api.content.import', {
                jobIds
            }, req))
        }).catch(err => {
            res.status(500);
            res.send(Response.error(`api.content.import`, 400, err.message))
        });;
    }

    import(req: any, res: any): any {
        logger.debug(`ReqId = "${req.headers['X-msgid']}": Import method is called to import content`);
        let downloadsPath = this.fileSDK.getAbsPath(this.ecarsFolderPath);
        let busboy = new Busboy({ headers: req.headers });
        logger.info(`ReqId = "${req.headers['X-msgid']}": Path to import Content: ${downloadsPath}`)
        busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
            // since file name's are having spaces we will generate uniq string as filename
            logger.info(`ReqId = "${req.headers['X-msgid']}": Generating UniqFileName for the requested file: ${filename}`)
            let hash = new Hashids(uuid.v4(), 25);
            let uniqFileName = hash.encode(1).toLowerCase() + path.extname(filename);
            logger.info(`ReqId = "${req.headers['X-msgid']}": UniqFileName: ${uniqFileName} is generated for File: ${filename} `);
            let filePath = path.join(downloadsPath, uniqFileName);
            req.fileName = uniqFileName;
            req.filePath = filePath;
            logger.info(`ReqId = "${req.headers['X-msgid']}": Uploading of file  ${filePath} started`);
            file.pipe(fs.createWriteStream(filePath));
        });
        busboy.on('finish', () => {
            logger.info(`ReqId = "${req.headers['X-msgid']}": Upload complete of the file ${req.filePath}`);
            logger.debug(`ReqId = "${req.headers['X-msgid']}": File extraction is starting for the file ${req.fileName}`);
            this.contentManager
                .startImport(req)
                .then(data => {
                    logger.info(`ReqId = "${req.headers['X-msgid']}": File extraction successful for file ${req.filePath}`);
                    res.send({ success: true, content: data });
                })
                .catch(error => {
                    logger.error(
                        `ReqId = "${req.headers['X-msgid']}": Error while file extraction  of file ${req.filePath}`,
                        error
                    );
                    res.send({ error: true });
                });
        });

        return req.pipe(busboy);
    }

    export(req: any, res: any): any {
        logger.debug(`ReqId = "${req.headers['X-msgid']}": export method is called to export Content`);
        (async () => {
            try {
                let id = req.params.id;
                // get the data from content db
                logger.debug(`ReqId = "${req.headers['X-msgid']}": Get Content: ${id} from ContentDB`)
                let content = await this.databaseSdk.get('content', id);
                logger.info(`ReqId = "${req.headers['X-msgid']}": Found the content: ${content.identifier} in ContentDb`);
                logger.debug(`ReqId = "${req.headers['X-msgid']}": Checking the content is of type Collection or not`);
                if (content.mimeType !== 'application/vnd.ekstep.content-collection') {
                    logger.info(`ReqId = "${req.headers['X-msgid']}": Found the Content:${id} is not of type Collection`)
                    let filePath = this.fileSDK.getAbsPath(
                        path.join('ecars', content.desktopAppMetadata.ecarFile)
                    );
                    fs.stat(filePath, async err => {
                        if (err) {
                            logger.error(
                                `ReqId = "${req.headers['X-msgid']}": ecar file not available while exporting for content ${id} and err.message: ${
                                err.message
                                }`
                            );
                            res.status(500);
                            return res.send(Response.error('api.content.export', 500));
                        } else {
                            logger.info(`ReqId = "${req.headers['X-msgid']}": joining the ecars and temp for the content path`)
                            await this.fileSDK.copy(
                                path.join('ecars', content.desktopAppMetadata.ecarFile),
                                path.join('temp', `${content.name}.ecar`)
                            );
                            logger.info(`ReqId = "${req.headers['X-msgid']}": joined ecars and temp for the content path`)
                            logger.debug(`ReqId = "${req.headers['X-msgid']}": Has to call CleanUpExport to delete the Content after export`);
                            this.cleanUpExports(path.join('temp', `${content.name}.ecar`), req.headers['X-msgid']);
                            res.status(200);
                            res.send(
                                Response.success(`api.content.export`, {
                                    response: {
                                        url: `${req.protocol}://${req.get('host')}/temp/${
                                            content.name
                                            }.ecar`
                                    }
                                }, req)
                            );
                            logger.info(`ReqId = "${req.headers['X-msgid']}": Content:${id} Exported successfully`);
                        }
                    });
                } else {
                    logger.info(`ReqId = "${req.headers['X-msgid']}": Found content:${id} is of type Collection`);
                    //     - get the spine ecar
                    let collectionEcarPath = path.join(
                        'ecars',
                        content.desktopAppMetadata.ecarFile
                    );
                    //     - unzip to temp folder
                    logger.info(`ReqId = "${req.headers['X-msgid']}": Unzipping the temp folder for Collection:${id}`);
                    await this.fileSDK.mkdir('temp');
                    let collectionFolderPath = await this.fileSDK.unzip(
                        collectionEcarPath,
                        'temp',
                        true
                    );
                    logger.info(`ReqId = "${req.headers['X-msgid']}":  Reading the manifest file for Collection:${id}`)
                    let manifest = await this.fileSDK.readJSON(
                        path.join(collectionFolderPath, 'manifest.json')
                    );
                    // - read all childNodes and get non-collection items
                    logger.info(`ReqId = "${req.headers['X-msgid']}": Reading all the childNodes and getting non-collection items`)
                    let items = _.get(manifest, 'archive.items');
                    let parent: any | undefined = _.find(items, i => {
                        return (
                            i.mimeType === 'application/vnd.ekstep.content-collection' &&
                            i.visibility === 'Default'
                        );
                    });
                    const childNodes = _.get(parent, 'childNodes');
                    let collectionFolderRelativePath = path.join(
                        'temp',
                        path.parse(collectionEcarPath).name
                    );
                    logger.info(`ReqId = "${req.headers['X-msgid']}": Relativepath temp is added for the collection: ${id} `)
                    if (!_.isEmpty(childNodes)) {
                        logger.debug(`ReqId = "${req.headers['X-msgid']}": Find all the childnodes in ContentDB`)
                        let { docs: childContents = [] } = await this.databaseSdk.find(
                            'content',
                            {
                                selector: {
                                    $and: [
                                        {
                                            _id: {
                                                $in: childNodes
                                            }
                                        },
                                        {
                                            mimeType: {
                                                $nin: ['application/vnd.ekstep.content-collection']
                                            }
                                        }
                                    ]
                                }
                            }
                        );
                        logger.info(`ReqId = "${req.headers['X-msgid']}": Found the childnodes in ContentDB`);
                        for (let childContent of childContents) {
                            let ecarPath = _.get(childContent, 'desktopAppMetadata.ecarFile');
                            if (!_.isEmpty(ecarPath)) {
                                let contentFolderPath = path.join(
                                    collectionFolderRelativePath,
                                    childContent.identifier
                                );
                                logger.info(`ReqId = "${req.headers['X-msgid']}": Deleting the folder in collection`);
                                await this.fileSDK.remove(contentFolderPath).catch(error => {
                                    logger.error(
                                        `ReqId = "${req.headers['X-msgid']}": Received Error while deleting the folder in collection ${contentFolderPath} `
                                    );
                                });
                                logger.info(`ReqId = "${req.headers['X-msgid']}": making a New Directory for all the Contents in Collection`);
                                await this.fileSDK.mkdir(contentFolderPath);
                                await this.fileSDK.unzip(
                                    path.join('ecars', ecarPath),
                                    contentFolderPath,
                                    false
                                );
                            }
                        }
                    }

                    // - Zip the spine_folder and download
                    logger.info(`ReqId = "${req.headers['X-msgid']}": Zipping the folder to download `)
                    await this.fileSDK.zip(
                        collectionFolderRelativePath,
                        'temp',
                        `${parent.name}.ecar`
                    );
                    logger.debug(`ReqId = "${req.headers['X-msgid']}": Calling cleanUpExports to delte the Collection before export`)
                    this.cleanUpExports(path.join('temp', `${parent.name}.ecar`), req.headers['X-msgid']);
                    res.status(200);
                    res.send(
                        Response.success(`api.content.export`, {
                            response: {
                                url:
                                    req.protocol +
                                    '://' +
                                    req.get('host') +
                                    '/temp/' +
                                    `${parent.name}.ecar`
                            }
                        }, req)
                    );
                    logger.info(`ReqId = "${req.headers['X-msgid']}": Collection:${id} Exported successfully`)
                }
            } catch (error) {
                logger.error(
                    `ReqId = "${req.headers['X-msgid']}": Received error while processing the content export and err.message: ${
                    error.message
                    } `
                );
                res.status(500);
                return res.send(Response.error('api.content.export', 500));
            }
        })();
    }

    /*
          This method will clear the exported files after 5 min from the time the file is created
      */
    private cleanUpExports(file: string, reqId) {
        logger.debug(`ReqId = "${reqId}": CleanUpExports method is called to delete the file after Export `)
        let interval = setInterval(() => {
            try {
                logger.info(`ReqId = "${reqId}": Removed temp path for file: ${file} after export`);
                this.fileSDK.remove(file);
                clearInterval(interval);
            } catch (error) {
                logger.error(
                    `ReqId = "${reqId}": Received error while deleting the ${file} after export and err.message: ${
                    error.message
                    } `
                );
                clearInterval(interval);
            }
        }, 300000);
    }

    /* This method converts the buffer data to json and if any error will catch and return the buffer data */

    convertBufferToJson(proxyResData, req) {
        logger.debug(`ReqId = "${req.headers['X-msgid']}": Converting Bufferdata to json`)
        let proxyData;
        try {
            proxyData = JSON.parse(proxyResData.toString('utf8'));
        } catch (e) {
            console.log(e);
            logger.error(
                `ReqId = "${req.headers['X-msgid']}": Received error while parsing the Bufferdata to json: ${e}`
            );
            return proxyResData;
        }
        logger.info(`ReqId = "${req.headers['X-msgid']}": Succesfully converted Bufferdata to json`)
        return proxyData;
    }

    /*This method is to whether content is present and to store all the contents in all page sections to one array */

    decorateSections(sections, reqId) {
        logger.debug(`ReqId = "${reqId}": Called decorateSections to decorate content`)
        let contents = [];
        logger.info(`ReqId = "${reqId}": Fetching all the contentId's from all the sections into an array`);
        for (let section of sections) {
            if (!_.isEmpty(section.contents)) {
                for (let content of section.contents) {
                    contents.push(content);
                }
            }
        }
        logger.debug(`ReqId = "${reqId}": Calling decorateContent from decoratesections`)
        return this.decorateContentWithProperty(contents, reqId);
    }

    /* This method is to check contents are present in DB */

    async decorateContentWithProperty(contents, reqId) {
        logger.debug(`ReqId = "${reqId}": Called decorateContent to decorate content`)
        try {
            let listOfContentIds = [];
            logger.info(`ReqId = "${reqId}": Pushing all the contentId's to an Array for all the requested Contents`)
            for (let content of contents) {
                listOfContentIds.push(content.identifier);
            }
            logger.debug(`ReqId = "${reqId}": Search downloaded and downloading  contents in DB using content Id's`)
            await this.searchDownloadingContent(listOfContentIds, reqId)
                .then(data => {
                    logger.info(`ReqId = "${reqId}": Found the ${data.docs.length} contents in Content_Download Db`)
                    for (let doc of data.docs) {
                        for (let content of contents) {
                            if (doc.contentId === content.identifier) {
                                content.downloadStatus = DOWNLOAD_STATUS[doc.status];
                            }
                        }
                    }
                })
                .catch(err => {
                    console.log(err);
                    logger.error(
                        `ReqId = "${reqId}": Received error while getting the data from database and err.message: ${
                        err.message
                        } ${err}`
                    );
                    return contents;
                });
        } catch (err) {
            console.log(err);
            logger.error(`ReqId = "${reqId}": Received  error err.message: ${err.message} ${err}`);
            return contents;
        }
        return contents;
    }

    /* This method is to check dialcode contents present in DB */

    decorateDialCodeContents(content, reqId) {
        logger.debug(`ReqId = "${reqId}": Decorating Dial Code Contents`);
        const model = new TreeModel();
        let treeModel;
        treeModel = model.parse(content);
        let contents = [];
        contents.push(content);
        logger.info(`ReqId = "${reqId}": walking through all the nodes and pushing all the child nodes to an array`);
        treeModel.walk(node => {
            if (node.model.mimeType !== 'application/vnd.ekstep.content-collection') {
                contents.push(node.model);
            }
        });
        logger.debug(`ReqId = "${reqId}": Calling decorateContent from decoratedialcode`)
        return this.decorateContentWithProperty(contents, reqId);
    }

    /* This method is to search contents for download status in database  */

    searchDownloadingContent(contents, reqId) {
        logger.debug(`ReqId = "${reqId}": searchDownloadingContent method is called`);
        let dbFilters = {
            "selector": {
                "contentId": {
                    "$in": contents
                }
            }
        }
        logger.info(`ReqId = "${reqId}": finding downloading, downloaded or failed contents in database`)
        return this.databaseSdk.find('content_download', dbFilters)
    }

    isUpdateRequired(content, req) {
        logger.debug(`ReqId = "${req.headers['X-msgid']}": Called isUpdateRequired()`);

        if (_.get(content, 'desktopAppMetadata.updateAvailable')) {
            logger.info(`ReqId = "${req.headers['X-msgid']}": updateAvailble for content and Don't call API`);
            return false;
        } else if (_.get(content, 'desktopAppMetadata.lastUpdateCheckedOn')) {
            logger.info(`ReqId = "${req.headers['X-msgid']}": checking when is the last updatechecked on`, _.get(content, 'desktopAppMetadata.lastUpdateCheckedOn'));
            return ((Date.now() - _.get(content, 'desktopAppMetadata.lastUpdateCheckedOn')) / 3600000) > INTERVAL_TO_CHECKUPDATE ? true : false;
        }
        logger.info(`ReqId = "${req.headers['X-msgid']}": update is not available for content and call API`);
        return true;
    }


    checkForUpdates(offlineContent, req) {
        logger.debug(`ReqId = "${req.headers['X-msgid']}": calling api to check whether content: ${_.get(offlineContent, 'idenitifier')} is updated`);
        return new Promise(async (resolve, reject) => {
            try {
                let onlineContent = await HTTPService.get(`${process.env.APP_BASE_URL}/api/content/v1/read/${offlineContent.identifier}?field=pkgVersion`, {}).toPromise();
                if (_.get(offlineContent, 'pkgVersion') < _.get(onlineContent, 'data.result.content.pkgVersion')) {
                    offlineContent.desktopAppMetadata.updateAvailable = true;
                    offlineContent.desktopAppMetadata.lastUpdateCheckedOn = Date.now();
                    offlineContent.desktopAppMetadata.updatedOn = Date.now();
                    await this.databaseSdk.update('content', offlineContent.identifier, offlineContent);
                    resolve(offlineContent);
                } else {
                    offlineContent.desktopAppMetadata.lastUpdateCheckedOn = Date.now();
                    offlineContent.desktopAppMetadata.updatedOn = Date.now();
                    await this.databaseSdk.update('content', offlineContent.identifier, offlineContent);
                    resolve(offlineContent);
                }
            } catch (err) {
                logger.error(`ReqId = "${req.headers['X-msgid']}": Error occured while checking content update : ${err}`);
                resolve(offlineContent);
            }
        })
    }

}
