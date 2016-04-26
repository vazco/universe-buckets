const BUCKET_SEP = '→';
const _collections = {};
const _collectionNamesPerBucket = {};
const _collectionDeps = {};
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
        this._activeHandlers = {};
        this._collectionDeps = {};
        const devNull = () => {
        };
        ['beginUpdate', 'endUpdate', 'saveOriginals',
            'retrieveOriginals', 'getDoc'].forEach(hName => this._defaultHandlers[hName] = devNull);

        if (Meteor.isClient) {
            // there can be only one store registered
            this._connection.registerStore('__bucket_collections', Object.assign(this._defaultHandlers, {
                update: ({msg, fields}) => {
                    if (msg !== 'added') {
                        return;
                    }
                    this._ensureCollection(fields.hash, fields.collection);
                }
            }));
        } else {
            this._publishHandlers = {};
        }
    }

    publish(bucketName, fn, options) {
        if (!bucketName || typeof bucketName !== 'string') {
            throw new Error('Missing name in bucket publication!');
        }
        if (this._publishHandlers[bucketName]) {
            throw new Error('Bucket "'+bucketName+'" publication already exists!');
        }
        const {condition} = options || {};
        const buckets = this;
        Meteor.publish(bucketName, function (hash, ...params) {
            check(hash, String);
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
                if (!collections[collection]) {
                    _added.call(this, '__bucket_collections', Random.id(), {
                        collection,
                        hash
                    });
                    collections[collection] = true;
                }
                return _added.call(this, getTransportName(hash, collection), ...args);
            };
            this.changed = (collection, ...args) => {
                return _changed.call(this, getTransportName(hash, collection), ...args);
            };
            this.removed = (collection, id) => {
                if (!this._documents[collection]) {
                    collection = getTransportName(hash, collection);
                    if (!this._documents[collection]) {
                        console.error('some bug? or removed already');
                        return;
                    }
                }
                return _removed.call(this, collection, id);
            };
            return filterCursors (hash, bucketName, fn, params, this);
        });

        Meteor.methods({
            ['bucketsLoad'+BUCKET_SEP+bucketName] (hash, ...params) {
                const data = {};
                const tasks = [];
                const ctx = {
                    added (collection, id, doc) {
                        const transportName = getTransportName(hash, collection);
                        if (!data[transportName]) {
                            data[transportName] = {};
                        }
                        data[transportName][id] = doc;
                    },
                    changed () {
                    },
                    removed () {
                    },
                    userId: this.userId,
                    onStop: cb => tasks.push(cb),
                    error: err => {
                        if (err) {
                            throw new err
                        }
                    },
                    stop () {
                        tasks.forEach(task => task());
                    },
                    connection: this.connection
                };
                let _waitOnReady = false;
                ctx.ready = () => _waitOnReady = false;
                ctx._willBeAsync = () => {
                    _waitOnReady = true;
                    this.unblock();
                };
                const cursors = filterCursors(hash, bucketName, fn, params, ctx);
                if (cursors && cursors.length) {
                    cursors.forEach(cursor=> cursor._publishCursor(ctx));
                }
                if (!_waitOnReady) {
                    ctx.stop();
                    return data;
                }
                const getResult = Meteor.wrapAsync(cb => {
                    const task = () => {
                        if (!_waitOnReady) {
                            ctx.stop();
                            return cb(null, data);
                        }
                        Meteor.setTimeout(task, 1000);
                    };
                    return task();
                });
                return getResult();
            }
        });

        this._publishHandlers[bucketName] = true;
    }

    subscribe(bucketName, ...params) {
        if (!bucketName || typeof bucketName !== 'string') {
            throw new Error('Missing name in bucket subscription!');
        }
        const {callbacks, readyPromise, stopPromise, context} = addPromisesApi(params, this);
        const hash = getHashFromParams(bucketName, ...params);
        const handler = this._connection.subscribe(bucketName, hash, ...params, callbacks);
        handler._name = bucketName;
        handler.isStatic = false;
        handler.subscriptionHash = hash;
        _activateSubs(this, handler);
        addDocsApi(handler, this, bucketName);
        handler.onStop = onStopCB => {
            if (typeof onStopCB !== 'function') {
                throw new Error('Expected function, instead got:'+ (typeof onStopCB));
            }
            if (!handler._onStop) {
                handler._onStop = [];
            }
            handler._onStop.push(onStopCB);
            return handler;
        };
        addAutoApi(handler, this, stopPromise, bucketName);
        context.getHandler = () => handler;
        return Object.assign(readyPromise, handler);
    }

    load (bucketName, ...params) {
        const hash = getHashFromParams(bucketName, ...params);
        const fakeHandler = {
            _name: bucketName,
            subscriptionId: Random.id(),
            isStatic: true,
            subscriptionHash: hash,
            ready: () => {
                if (!fakeHandler._deps) {
                    fakeHandler._deps = new Tracker.Dependency();
                }
                fakeHandler._deps.depend();
                return !!fakeHandler._ready;
            },
            stop: () => {
                if (deactivate(undefined, fakeHandler, this)) {
                    unload(hash, this);
                }
                return fakeHandler;
            },
            onStop: (onStopCB) => {
                if (typeof onStopCB !== 'function') {
                    throw new Error('Expected function, instead got:' + (typeof onStopCB));
                }
                if (!fakeHandler._onStop) {
                    fakeHandler._onStop = [];
                }
                fakeHandler._onStop.push(onStopCB);
                return fakeHandler;
            },
            observeCursor: (cursor) => {
                if (!cursor && !cursor.observeChanges) {
                    throw new Error('Cursor object was expected');
                }
                const transportName = getTransportName(hash, cursor._getCollectionName());
                const coll = this._ensureCollection(transportName);
                if (!fakeHandler._tasks) {
                    fakeHandler._tasks = [];
                }
                const storeDef = this._connection._stores[transportName];
                storeDef.beginUpdate();
                let init = true;
                fakeHandler._tasks.push(cursor.observeChanges({
                    added (id, fields) {
                        if (!init) {
                            storeDef.beginUpdate();
                        }
                        var doc = coll._collection.findOne(id);
                        if (doc) {
                            storeDef.update({
                                msg: 'changed',
                                fields,
                                id
                            });
                        } else {
                            storeDef.update({
                                msg: 'added',
                                fields,
                                id
                            });
                        }
                        if (!init) {
                            storeDef.endUpdate();
                        }
                    },
                    changed(id, fields) {
                        _.delay(()=> {
                            storeDef.beginUpdate();
                            var doc = coll._collection.findOne(id);
                            if (!doc) {
                                fields = cursor.collection.findOne(id);
                                delete fields._id;
                                storeDef.update({
                                    msg: 'added',
                                    fields,
                                    id
                                });
                                // coll._collection.insert(cursor.collection.findOne(id));
                            } else {
                                storeDef.update({
                                    msg: 'changed',
                                    fields,
                                    id
                                });
                            }
                            storeDef.endUpdate();
                        });


                        // var modifier = {};
                        // _.each(fields, function (value, key) {
                        //     if (value === undefined) {
                        //         if (!modifier.$unset)
                        //             modifier.$unset = {};
                        //         modifier.$unset[key] = 1;
                        //     } else {
                        //         if (!modifier.$set)
                        //             modifier.$set = {};
                        //         modifier.$set[key] = value;
                        //     }
                        // });
                        // console.log('modifier', modifier, id);
                        // coll._collection.update(id, modifier);
                        // // Meteor.setTimeout(() => console.log('->',coll._collection.findOne(id), coll._name), 1000);
                        // console.log('->',coll._collection.findOne(id), coll._name);

                    },
                    removed (id) {
                        storeDef.beginUpdate();
                        var doc = coll._collection.findOne(id);
                        if (doc) {
                            // coll._collection.remove(id);
                            storeDef.update({
                                msg: 'removed',
                                id
                            });
                        }
                        storeDef.endUpdate();
                    }
                }));
                storeDef.endUpdate();
                init = false;
                return fakeHandler;
            }
        };
        _activateSubs(this, fakeHandler);
        addDocsApi(fakeHandler, this, bucketName);
        addAutoApi(fakeHandler, this, Promise.resolve(fakeHandler));
        let promiseResult = new Promise((resolve, reject) => Meteor.call('bucketsLoad'+BUCKET_SEP+bucketName, hash, ...params,
            (err, data) => {
                if (err) {
                    deactivate(err, fakeHandler, this);
                    reject(err);
                    return;
                }
                //todo: update collections in buckets
                Object.keys(data).forEach(collName => {
                    this._ensureCollection(collName);
                    const storeDef = this._connection._stores[collName];
                    var _update = storeDef.update;
                    storeDef.update = (msg) => {
                        if (msg.msg === 'added') {
                            msg.msg = 'replace';
                            msg.replace = msg.fields;
                        }
                        return _update.call(storeDef, msg);
                    };
                    if(!data[collName]){
                        return;
                    }
                    storeDef.beginUpdate();
                    Object.keys(data[collName]).forEach(id => {
                        const doc = data[collName][id];
                        doc._id = id;
                        storeDef.update({
                            msg:  'replace',
                            replace: data[collName][id],
                            collection: collName,
                            id
                        })
                    });
                    storeDef.endUpdate();
                });
                resolve(fakeHandler);
                if (this._deps){
                    this._deps.changed();
                }
            }));
        return Object.assign(promiseResult, fakeHandler);
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
        const name = getTransportName.apply(undefined, args);
        if (!_collections[name]) {
            let CollectionClass = this._CollectionClass._default_;
            if (this._CollectionClass[name]) {
                CollectionClass = this._CollectionClass[name];
            }
            _collections[name] = new CollectionClass(name, {connection: this._connection});
            let hash = args[0];
            if (hash === name) {
                hash = hash.split(BUCKET_SEP)[0];
            }
            if (!_collectionNamesPerBucket[hash]) {
                _collectionNamesPerBucket[hash] = [];
            }
            _collectionNamesPerBucket[hash].push(name);
            if (_collectionDeps[hash] && _collectionDeps[hash].depend) {
                _collectionDeps[hash].depend();
            }
        }
        return _collections[name];
    }
}

function getTransportName (...args) {
    if (args[1] && args[1]._name && args[1] instanceof Mongo.Collection) {
        args[1] = args[1]._name;
    }
    return args.join(BUCKET_SEP);
}

function filterCursors (hash, bucketName, fn, params, ctx) {
    let result = fn.call(ctx, ...params);
    if (!result) {
        ctx._willBeAsync();
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
            ctx.added(bucketName, _id, customDoc);
            ctx.onStop(() => ctx.removed(bucketName, _id));
        })
    });
    if (!result || !result.length) {
        ctx.ready();
    }
    return result;
}

function _activateSubs (buckets, handler) {
    if (!buckets._activeHandlers[handler.subscriptionHash]) {
        buckets._activeHandlers[handler.subscriptionHash] = {};
    }
    buckets._activeHandlers[handler.subscriptionHash][handler.subscriptionId] = handler;
}

function unload (subscriptionHash, buckets) {
    const collectionNames = _collectionNamesPerBucket[subscriptionHash] || [];
    collectionNames.forEach(collName => {
        const ids = buckets._ensureCollection(collName).find().map(doc => doc._id) || [];
        const storeDef = buckets._connection._stores[collName];
        storeDef.beginUpdate();
        ids.forEach(id => storeDef.update({
            msg:  'removed',
            collection: collName,
            id
        }));
        storeDef.endUpdate();
    });

}

function addPromisesApi(params, buckets) {
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
                deactivate(e, handler, buckets);
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
            _stop.call(handler);
        } else {
            Meteor.setTimeout(_stop.bind(handler), _cacheExpirationTime);
        }
        return Object.assign(stopPromise, handler);
    };

}

function addDocsApi(handler, scope, bucketName) {
    handler.getDocs = (collectionNames, selector = {}, options = {}) => {
        if (Array.isArray(collectionNames)){
            collectionNames = collectionNames.map(cName => getTransportName(handler.subscriptionHash, cName));
        }
        if (!collectionNames) {
            if (collectionNames === null) {
                collectionNames = [getTransportName(handler.subscriptionHash, bucketName)];
            } else {
                collectionNames = _collectionNamesPerBucket[handler.subscriptionHash] || [];
                dependCollsCount(handler.subscriptionHash, options.reactive !== false);
            }
        }
        if (typeof collectionNames === 'string' ||
            (typeof collectionNames === 'object' && collectionNames instanceof  Mongo.Collection)) {
            collectionNames = [getTransportName(handler.subscriptionHash, collectionNames)];
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
    handler.getCount = (collectionNames, selector = {}, options = {}) => {
        if (Array.isArray(collectionNames)){
            collectionNames = collectionNames.map(cName => getTransportName(handler.subscriptionHash, cName));
        }
        if (!collectionNames) {
            if (collectionNames === null) {
                collectionNames = [getTransportName(handler.subscriptionHash, bucketName)];
            } else {
                collectionNames = _collectionNamesPerBucket[handler.subscriptionHash] || [];
                dependCollsCount(handler.subscriptionHash, options.reactive !== false);
            }
        }
        if (typeof collectionNames === 'string') {
            collectionNames = [getTransportName(handler.subscriptionHash, collectionNames)];
        }
        let count = 0;
        collectionNames.forEach(fullName => {
            const coll = scope._ensureCollection(fullName);
            if (coll) {
                count += coll.find(selector, options).count();
            }
        });
        return count;
    };
    handler.getDoc = (name, selector = {}, options = {}) => {
        name = name || bucketName;
        const coll = scope._ensureCollection(handler.subscriptionHash, name);
        if (coll) {
            return coll.findOne(selector, options);
        }
    };
}

const _mapHashes = {};
//should be used only on client
function getHashFromParams (...params) {
    const paramsStr = EJSON.stringify(params);
    if (!_mapHashes[paramsStr]) {
        _mapHashes[paramsStr] = Random.id();
    }
    return _mapHashes[paramsStr];
}

function deactivate (err, handler, buckets) {
    if (err) {
        Meteor._debug && Meteor._debug(err);
        return;
    }
    if (handler._tasks) {
        handler._tasks.forEach(task => task.stop());
    }
    if (handler._onStop) {
        handler._onStop.forEach(stopCb => stopCb && stopCb(handler));
    }
    delete buckets._activeHandlers[handler.subscriptionHash][handler.subscriptionId];
    if (!Object.keys(buckets._activeHandlers[handler.subscriptionHash]).length) {
        return delete buckets._activeHandlers[handler.subscriptionHash];
    }
}

function dependCollsCount (subscriptionHash, reactive = true) {
    if (reactive) {
        if (!_collectionDeps[subscriptionHash]) {
            _collectionDeps[subscriptionHash] = new Tracker.Dependency();
        }
        _collectionDeps[subscriptionHash].depend();
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
            delete this['publish'];
        }
    }

    publish(fn) {
        return this._buckets.publish(this._name, fn);
    }

    subscribe(...params) {
        return this._buckets.subscribe(this._name, ...params);
    }

    load(...params) {
        return this._buckets.load(this._name, ...params);
    }

    prepare(...params) {
        return this._buckets.prepare(this._name, ...params);
    }
}

function isCursor(c) {
    return c && c._publishCursor;
}

export default Bucket;
export {Buckets, Bucket};