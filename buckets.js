const BUCKET_SEP = '→';

class Buckets {
    constructor (params) {
        const {storageClass = Mongo.Collection, connection = Meteor.connection} = params || {};
        if (Meteor.isClient) {
            //publish can be called only on server side!
            delete this.publish;
        }
        this._storageClass = {};
        this._storageClass.default = storageClass;
        this._collections = {};
        this._connection = connection;
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
            let {added, changed, removed} = this;
            const collections = {};
            return fn.call(Object.assign(this, {
                added (collection, ...args) {
                    const partName = bucketName + BUCKET_SEP + collection;
                    if (!collections[collection]) {
                        added.call(this, '__bucket_collections', partName, {collection});
                    }
                    return added.call(this, partName, ...args);
                },
                changed (collection, ...args) {
                    return changed.call(this, bucketName + BUCKET_SEP + collection, ...args);
                },
                removed (collection, ...args) {
                    return removed.call(this, bucketName + BUCKET_SEP + collection, ...args);
                }
            }), ...params);
        })
    }

    subscribe (bucketName) {
        const handler = this._connection.subscribe(bucketName);
        handler.getCollection = name => this._ensureCollection(bucketName+BUCKET_SEP+name);
        return handler;
    }

    _ensureCollection (name) {
        if (!this._collections[name]) {
            let storageClass = this._storageClass.default;
            if (this._storageClass[name]) {
                storageClass = this._storageClass[name];
            }
            this._collections[name] = new storageClass(name, {connection: this._connection});
        }
        return this._collections[name];
    }
}

export default Buckets;