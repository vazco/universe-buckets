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
            this._connection.registerStore('__bucket_collections', Object.assign(this._defaultHandlers, {
                update: ({id}) => {
                    if (!_collectionsPerBucket[id.split(BUCKET_SEP)[0]]) {
                        _collectionsPerBucket[id.split(BUCKET_SEP)[0]] = [];
                    }
                    _collectionsPerBucket[id.split(BUCKET_SEP)[0]].push(this._ensureCollection(id));
                }
            }));
        }

        this._emitters = {};
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
                    _added.call(this, '__bucket_collections', partName, {collection});
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
                    this.added(bucketName, _id , customDoc);
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
        handler.then = readyPromise.then.bind(readyPromise);
        handler.catch = readyPromise.catch.bind(readyPromise);
        addAutoApi(handler, this, stopPromise, bucketName);
        addEventApi(handler, this, bucketName);
        context.getHandler = () => _.omit(handler, 'then', 'catch');
        return handler;
    }

    prepare(bucketName, ...params) {
        const BucketsScope = function () {
        };
        BucketsScope.prototype = this;
        const _CollectionClass = {};
        let _cacheExpirationTime;
        let addedFns = [];
        let changedFns = [];
        let removedFns = [];
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
            },
            onAdded: callback => {
                addedFns.push(callback);
                return result;
            },
            onChanged: callback => {
                changedFns.push(callback);
                return result;
            },
            onRemoved: callback => {
                removedFns.push(callback);
                return result;
            },
            offAdded: callback => {
                addedFns = _.without(addedFns, callback);
                return result;
            },
            offChanged: callback => {
                changedFns = _.without(changedFns, callback);
                return result;
            },
            offRemoved: callback => {
                removedFns = _.without(removedFns, callback);
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
            const self = this;
            const _update = this._connection._stores[name].update;
            this._connection._stores[name].update = function ({msg, collection, id, fields}) {
                const [bucketName, collectionName] = collection.split(BUCKET_SEP);
                if (self._emitters[bucketName]) {
                    self._emitters[bucketName].emit(msg, collectionName, fields);
                }
                return _update.apply(this, arguments);
            }
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
                if (e && callError) {
                    callError(e);
                } else {
                    callStop(context.getHandler());
                }
                return onStop && onStop.call(this, e);
            }
        }
    }
}

function addEventApi(handler, scope, bucketName) {
    handler.onAdded = callback => {
        if (!scope._emitters[bucketName]) {
            scope._emitters[bucketName] = new UniUtils.Emitter();
        }
        scope._emitters[bucketName].on('added', callback);
        return this;
    };
    handler.onChanged = callback => {
        if (!scope._emitters[bucketName]) {
            scope._emitters[bucketName] = new UniUtils.Emitter();
        }
        scope._emitters[bucketName].on('changed', callback);
        return this;
    };
    handler.onRemoved = callback => {
        if (!scope._emitters[bucketName]) {
            scope._emitters[bucketName] = new UniUtils.Emitter();
        }
        scope._emitters[bucketName].on('removed', callback);
        return this;
    };

    handler.offAdded = callback => {
        if (scope._emitters[bucketName]) {
            scope._emitters[bucketName].off('added', callback);
        }
        return this;
    };
    handler.offChanged = callback => {
        if (scope._emitters[bucketName]) {
            scope._emitters[bucketName].off('changed', callback);
        }
        return this;
    };
    handler.offRemoved = callback => {
        if (scope._emitters[bucketName]) {
            scope._emitters[bucketName].on('removed', callback);
        }
        return this;
    };
}

function addAutoApi(handler, scope, stopPromise, bucketName) {
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
    handler.stop = function (...args) {
        Meteor.setTimeout(() => {
            if (handler._tasks) {
                handler._tasks.forEach(task => task.stop());
            }
            delete scope._emitters[bucketName];
            _stop.apply(this, args);
        }, _cacheExpirationTime);
        return stopPromise;
    }
}

function addDocsApi(handler, scope, bucketName) {
    handler.getDocs = (collectionNames, selector = {}, options = {}) => {
        if (!handler.ready()) {
            return [];
        }
        if (typeof collectionNames === 'string') {
            const coll = scope._ensureCollection(bucketName, collectionNames);
            if (coll) {
                return coll.find(selector, options).fetch();
            }
            return [];
        }
        if (!collectionNames) {
            collectionNames = _collectionsPerBucket[bucketName].map(c => c._name) || [];
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
            collectionNames = _collectionsPerBucket[bucketName].map(c => c._name) || [];
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

function isCursor (c) {
    return c && c._publishCursor;
}

export default Bucket;
export {Buckets, Bucket};