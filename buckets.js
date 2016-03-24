class Buckets {
    constructor (params) {
        const {dbClass = Mongo.Collection, connection = Meteor.connection} = params || {};
        if (Meteor.isClient) {
            //publish can be called only on server side!
            delete this.publish;
        }
        this._dbClass = dbClass;
        this._collections = {};
        this._connection = connection;
        // this._emitter = new UniUtils.Emitter();
        this._defaultHandlers = {};
        const devNull = () => {};
        ['update', 'beginUpdate', 'endUpdate', 'saveOriginals',
            'retrieveOriginals', 'getDoc'].forEach(hName => this._defaultHandlers[hName] = devNull);
        if (Meteor.isClient) {
            connection.registerStore('__bucket_collections', Object.assign(this._defaultHandlers, {
                update: ({id}) => this._ensureCollection(id)
            }));
        }
    }
    publish (name, fn) {
        if (!name || typeof name !== 'string') {
            throw new Error ('Missing name in bucket publication!');
        }
        const bucketName = 'buckets/'+name;
        return Meteor.publish(bucketName, function (...params) {
            let {added, changed, removed} = this;
            const collections = {};
            return fn.call(Object.assign(this, {
                added (collection, ...args) {
                    const partName = bucketName + '/' + collection;
                    if (!collections[collection]) {
                        added.call(this, '__bucket_collections', partName, {collection, name});
                    }
                    return added.call(this, partName, ...args);
                },
                changed (collection, ...args) {
                    return changed.call(this, bucketName + '/' + collection, ...args);
                },
                removed (collection, ...args) {
                    return removed.call(this, bucketName + '/' + collection, ...args);
                }
            }), ...params);
        })
    }

    subscribe (name) {
        const bucketName = 'buckets/'+name;
        const handler = this._connection.subscribe(bucketName);
        handler.getCollection = name => this._ensureCollection(bucketName+'/'+name);
        return handler;
    }

    _ensureCollection (name) {
        if (!this._collections[name]) {
            this._collections[name] = new this._dbClass(name, {connection: this._connection});
        }
        return this._collections[name];
    }
}

export default Buckets;