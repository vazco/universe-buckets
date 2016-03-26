const BUCKET_SEP = '→';
const _collections = {};
class Buckets {
    constructor (params) {
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
        // this._emitter = new UniUtils.Emitter();
        this._defaultHandlers = {};
        const devNull = () => {};
        ['update', 'beginUpdate', 'endUpdate', 'saveOriginals',
            'retrieveOriginals', 'getDoc'].forEach(hName => this._defaultHandlers[hName] = devNull);

        if (Meteor.isClient) {
            this._connection.registerStore('__bucket_collections', Object.assign(this._defaultHandlers, {
                update: ({id}) => this._ensureCollection(id)
            }));
        }
    }
    publish (bucketName, fn) {
        if (!bucketName || typeof bucketName !== 'string') {
            throw new Error ('Missing name in bucket publication!');
        }
        return Meteor.publish(bucketName, function (...params) {
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
            return fn.call(this, ...params);
        })
    }

    subscribe (bucketName, ...params) {
        const {callbacks, readyPromise, stopPromise, context} = addPromisesApi(params);
        const handler = this._connection.subscribe(bucketName, ...params, callbacks);
        handler._name = bucketName;
        handler.getCollection = name => this._ensureCollection(bucketName+BUCKET_SEP+name);
        handler.then = readyPromise.then.bind(readyPromise);
        handler.catch = readyPromise.catch.bind(readyPromise);
        addAutoApi(handler, this, stopPromise);
        context.getHandler = () => _.omit(handler, 'then', 'catch');
        return handler;
    }

    prepareSubscription(bucketName, ...params) {
        const _CollectionClass = {};
        const Backet = function () {};
        Backet.prototype = this;
        const scope = new Backet();
        return {
            _name: bucketName,
            start: this.subscribe.bind(scope, bucketName, ...params),
            setCollectionClass: (CollectionClass, name = '_default_') => _CollectionClass[fullName] = CollectionClass,
            setCacheExpirationTime: time => scope._cacheExpirationTime = time,
            getCollection: name => scope._ensureCollection(bucketName+BUCKET_SEP+name, _CollectionClass[name])
        }
    }

    _ensureCollection (name, _CollectionClass) {
        if (!_collections[name]) {
            let CollectionClass = this._CollectionClass._default_;
            if (this._CollectionClass[name]) {
                CollectionClass = this._CollectionClass[name];
            }
            if (_CollectionClass) {
                CollectionClass = _CollectionClass;
            }
            _collections[name] = new CollectionClass(name, {connection: this._connection});
        }
        return _collections[name];
    }
}

function addPromisesApi (params) {
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

function addAutoApi (handler, scope, stopPromise) {
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
            _stop.apply(this, args);
        }, _cacheExpirationTime);
        return stopPromise;
    }
}

export default Buckets;