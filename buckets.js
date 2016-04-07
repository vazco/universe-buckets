const BUCKET_SEP = '→';
const _collections = {};
const _collectionsPerBucket = {};
class Buckets {
    constructor(params) {
        const {
            storageClass = Mongo.Collection,
            connection = Meteor.connection,
            cacheExpirationTime = 0
        } = params || {};
        if (Meteor.isClient) {
            //publish can be called only on server side!
            delete this.publish;
        }
        this._CollectionClass = {_default_: storageClass};
        this._connection = connection;
        this._cacheExpirationTime = cacheExpirationTime;
        this._defaultHandlers = {};
        const devNull = () => {
        };
        ['beginUpdate', 'endUpdate', 'saveOriginals',
            'retrieveOriginals', 'getDoc'].forEach(hName => this._defaultHandlers[hName] = devNull);

        if (Meteor.isClient) {
            // there can be only one store registered
            this._connection.registerStore('__bucket_collections', Object.assign(this._defaultHandlers, {
                update: ({fields}) => {
                    const {bucketName, collection, subscriptionId} = fields;
                    if (!_collectionsPerBucket[bucketName]) {
                        _collectionsPerBucket[bucketName] = {};
                    }
                    if (!_collectionsPerBucket[bucketName][subscriptionId]) {
                        _collectionsPerBucket[bucketName][subscriptionId] = [];
                    }
                    _collectionsPerBucket[bucketName][subscriptionId].push(
                        this._ensureCollection(bucketName, collection, subscriptionId)
                    );
                }
            }));
        }
    }

    publish(bucketName, fn, options) {
        if (!bucketName || typeof bucketName !== 'string') {
            throw new Error('Missing name in bucket publication!');
        }
        const {condition} = options || {};
        return Meteor.publish(bucketName, function (...params) {
            if (typeof condition === 'function') {
                if (!condition(Meteor.users(this.userId))) {
                    this.ready();
                    return;
                }
            }
            const _added = this.added;
            const _changed = this.changed;
            const _removed = this.removed;
            const collections = {};
            this.added = (collection, ...args) => {
                const partName = bucketName + BUCKET_SEP + collection;
                if (!collections[collection]) {
                    _added.call(this, '__bucket_collections', Random.id(), {
                        bucketName,
                        collection,
                        subscriptionId: this._subscriptionId
                    });
                    collections[collection] = true;
                }
                return _added.call(this, partName, ...args);
            };
            this.changed = (collection, ...args) => {
                return _changed.call(this, bucketName + BUCKET_SEP + collection, ...args);
            };
            this.removed = (collection, id) => {
                if (!this._documents[collection]) {
                    collection = bucketName + BUCKET_SEP + collection;
                    if (!this._documents[collection]) {
                        console.error('some bug? or removed already');
                        return;
                    }
                }
                return _removed.call(this, collection, id);
            };
            let result = fn.call(this, ...params);
            if (!result) {
                return result;
            }
            if (!Array.isArray(result)) {
                result = [result];
            }
            let index = 0;
            result = result.filter(item => {
                if (isCursor(item)) {
                    return true;
                }
                if (!Array.isArray(item)) {
                    item = [item];
                }
                item.forEach(customDoc => {
                    const {_id = index++} = customDoc;
                    this.added(bucketName, _id, customDoc);
                })
            });

            return result;
        })
    }

    subscribe(bucketName, ...params) {
        if (!bucketName || typeof bucketName !== 'string') {
            throw new Error('Missing name in bucket subscription!');
        }
        const {callbacks, readyPromise, stopPromise, context} = addPromisesApi(params);
        const handler = this._connection.subscribe(bucketName, ...params, callbacks);
        handler._name = bucketName;
        addDocsApi(handler, this, bucketName);
        handler.onStop = onStopCB => {
            if (typeof onStopCB !== 'function') {
                throw new Error('Expected function, instead got:'+ (typeof onStopCB));
            }
            if (!handler._onStop) {
                handler._onStop = [];
            }
            handler._onStop.push(onStopCB);
        };
        addAutoApi(handler, this, stopPromise, bucketName);
        context.getHandler = () => handler;
        return Object.assign(readyPromise, handler);
    }
    obtainOnce (bucketName, ...params) {
        return this.subscribe(bucketName, ...params).then(handler => handler.deactivate());
    }
    prepare(bucketName, ...params) {
        const BucketsScope = function () {
        };
        BucketsScope.prototype = this;
        const _CollectionClass = {};
        let _cacheExpirationTime;
        const result = {
            _name: bucketName,
            start: (...args) => {
                const scope = new BucketsScope();
                Object.keys(_CollectionClass).forEach(k => scope._CollectionClass[name] = _CollectionClass[name]);
                if (_cacheExpirationTime) {
                    scope._cacheExpirationTime = _cacheExpirationTime
                }
                return scope.subscribe.call(scope, bucketName, ...params, ...args);
            },
            setCollectionClass: (CollectionClass, name = '_default_') => {
                _CollectionClass[name] = CollectionClass;
                return result;
            },
            setCacheExpirationTime: time => {
                _cacheExpirationTime = time;
                return result;
            }
        };
        return result;
    }

    _ensureCollection(...args) {
        const name = args.join(BUCKET_SEP);
        if (!_collections[name]) {
            let CollectionClass = this._CollectionClass._default_;
            if (this._CollectionClass[name]) {
                CollectionClass = this._CollectionClass[name];
            }
            _collections[name] = new CollectionClass(name, {connection: this._connection});
        }
        return _collections[name];
    }
}

function addPromisesApi(params) {
    let onReady, onStop, callError, callReady, callStop;
    const context = {};
    if (params.length) {
        var lastParam = params[params.length - 1];
        if (typeof lastParam === 'function') {
            onReady = params.pop();
        } else if (lastParam && [lastParam.onReady, lastParam.onStop].some(it => typeof it === 'function')) {
            const last = params.pop();
            onReady = last.onReady;
            onStop = last.onStop;
        }
    }

    const readyPromise = new Promise((resolve, reject) => {
        callReady = resolve;
        callError = reject
    });

    const stopPromise = new Promise(resolve => {
        callStop = resolve
    });

    return {
        readyPromise,
        stopPromise,
        context,
        callbacks: {
            onReady () {
                callReady && callReady(context.getHandler());
                return onReady && onReady.call(this);
            },
            onStop (e) {
                const handler = context.getHandler();
                if (e && callError) {
                    callError(e);
                } else {
                    callStop(handler);
                }
                doDeactivation(e, handler);
                return onStop && onStop.call(this, e);
            }
        }
    }
}

function addAutoApi(handler, scope, stopPromise) {
    handler.autorun = func => {
        if (!handler._tasks) {
            handler._tasks = [];
        }
        handler._tasks.push(Tracker.autorun(computation => {
            if (handler.ready()) {
                func.call(handler, computation)
            }
        }));
        return handler;
    };
    
    const _stop = handler.stop;
    const {_cacheExpirationTime = 0} = scope || {};

    handler.stop = function (immediately) {
        if (immediately) {
            return _stop.call(this);
        }
        Meteor.setTimeout(_stop.bind(handler), _cacheExpirationTime);
        return stopPromise;
    };

    handler.deactivate = () => {
        const subDef = scope._connection._subscriptions[handler.subscriptionId];
        if (!subDef && !handler.deactivated) {
            doDeactivation(new Error('Missing instance of subscription on connection'), handler);
            return handler;
        }
        if (!handler.deactivated) {
            if (subDef) {
                subDef.remove();
            }
            Meteor.call('deactivateUniverseBucket', handler.subscriptionId, (err) => doDeactivation(err, handler));
        }
        return handler;
    };
}

function addDocsApi(handler, scope, bucketName) {
    handler.getDocs = (collectionNames, selector = {}, options = {}) => {
        if (!handler.ready()) {
            return [];
        }
        if (typeof collectionNames === 'string') {
            const coll = scope._ensureCollection(bucketName, collectionNames, handler.subscriptionId);
            if (coll) {
                return coll.find(selector, options).fetch();
            }
            return [];
        }
        if (!collectionNames) {
            collectionNames = _collectionsPerBucket[bucketName][handler.subscriptionId].map(c => c._name) || [];
        }
        let docs = [];
        collectionNames.forEach(fullName => {
            const coll = scope._ensureCollection(fullName);
            if (coll) {
                docs.push(...(coll.find(selector, options).fetch()));
            }
        });
        return docs;
    };
    handler.getCount = (collectionNames, selector = {}) => {
        if (!collectionNames) {
            collectionNames = _collectionsPerBucket[bucketName][handler.subscriptionId].map(c => c._name) || [];
        }
        if (typeof collectionNames === 'string') {
            collectionNames = [collectionNames];
        }
        let count = 0;
        collectionNames.forEach(fullName => {
            const coll = scope._ensureCollection(fullName);
            if (coll) {
                count += coll.find(selector).count();
            }
        });
        return count;
    };
    handler.getDoc = (name, selector = {}, options = {}) => {
        const coll = scope._ensureCollection(bucketName, name);
        if (coll) {
            return coll.findOne(selector, options);
        }
    };
}

function doDeactivation (err, handler) {
    if (err) {
        Meteor._debug && Meteor._debug(err);
        return;
    }
    handler.deactivated = true;
    if (handler._tasks) {
        handler._tasks.forEach(task => task.stop());
    }
    if (handler._onStop) {
        handler._onStop.forEach(stopCb => stopCb && stopCb());
    }
}

let defaultBuckets;

class Bucket {
    constructor(bucketName, buckets = {}) {
        this._name = bucketName;
        if (buckets instanceof Buckets) {
            this._buckets = buckets;
        } else {
            if (buckets.connection) {
                this._buckets = new Buckets(buckets);
            } else {
                if (!defaultBuckets) {
                    defaultBuckets = new Buckets();
                }
                this._buckets = defaultBuckets;
            }
        }
        if (Meteor.isClient) {
            delete this.publish;
        }
    }

    publish(fn) {
        return this._buckets.publish(this._name, fn);
    }

    subscribe(...params) {
        return this._buckets.subscribe(this._name, ...params);
    }

    prepare(...params) {
        return this._buckets.prepare(this._name, ...params);
    }
}

function isCursor(c) {
    return c && c._publishCursor;
}

if (Meteor.isServer) {
    Meteor.methods({
        deactivateUniverseBucket (subscriptionId) {
            check(subscriptionId, String);
            const conId = this.connection.id;
            if (!conId) {
                throw new Error('Missing id of current connection!');
            }
            const connection = Meteor.server.sessions[conId];
            if (!connection || !connection._namedSubs) {
                throw new Error('Unrecognized connection for current session!');
            }
            if (!connection._namedSubs[subscriptionId]) {
                throw new Error('Unrecognized subscription for current connection!');
            }
            connection._namedSubs[subscriptionId]._deactivate();
        }
    });
}


export default Bucket;
export {Buckets, Bucket};