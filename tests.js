import {Bucket} from 'meteor/universe:buckets';
const TestCollection = new Mongo.Collection('testCollection');
const TestCollection2 = new Mongo.Collection('testCollection2');
TestCollection2.allow({insert: () => true});
const TestCollection3 = new Mongo.Collection('testCollection3');
const TestCollection4 = new Mongo.Collection('testCollection4');
const bucketA = new Bucket('bucketA');
const bucketB = new Bucket('bucketB');
const bucketC = new Bucket('bucketC');
const bucketD = new Bucket('bucketD');
const bucketE = new Bucket('bucketE');

const _allow = {
    insert: () => true,
    update: () => true,
    remove: () => true
};
TestCollection.allow(_allow);
TestCollection3.allow(_allow);
TestCollection4.allow(_allow);

if (Meteor.isServer) {
    TestCollection4.remove({});
    TestCollection4.insert({title: 'title1', _id: 'id1'});
    TestCollection4.insert({title: 'title2', _id: 'id2'});
    TestCollection4.insert({title: 'title3', _id: 'id3'});
    //
    TestCollection.remove({_id: {$exists: true}});
    TestCollection.insert({field1: 'a', _id: 'item1', title: 'title1'});
    TestCollection.insert({field1: 'b', _id: 'item2', title: 'title1'});
    TestCollection.insert({field1: 'c', _id: 'item3', title: 'title1'});

    bucketA.publish(function () {
        return [TestCollection.find({_id: {$in: ['item1', 'item2']}}), {_id: 'item0', field0: 'zero'}];
    });
    bucketB.publish(function () {
        return [TestCollection.find()];
    });
    bucketC.publish(function () {
        return [TestCollection.find(), TestCollection2.find()];
    });
    bucketD.publish(function () {
        return [TestCollection3.find()];
    });

    bucketE.publish(function () {
        return TestCollection4.find();
    });

    Meteor.publish('3test', function () {
        return TestCollection4.find();
    });

    Meteor.publish('1test', function () {
        return TestCollection.find();
    });

    Tinytest.addAsync('UniverseBucket - publish', function (test, onComplete) {
        test.equal(typeof bucketA.publish, 'function', 'Missing subscribe function');
        try {
            const someBucket = new Bucket('someBucket_' + Random.id());
            someBucket.publish({});
        } catch (e) {
            test.exception(e);
        }
        onComplete();
    });

} else {


    Tinytest.addAsync('UniverseBucket - subscribe', function (test, onComplete) {
        bucketA.subscribe().then( ({getDocs, getCount, getDoc, stop, ready}) => {
            test.isTrue(ready(), 'Subscribe must be ready');
            const docs = getDocs();
            test.isTrue(Array.isArray(docs), 'Should be an array!');
            test.equal(getCount(), 3, 'Count should be 3');
            test.equal(docs.length, 3, 'Should be 3 docs');
            const rDoc = getDoc(TestCollection);
            test.isTrue(rDoc && (rDoc._id === 'item1' || rDoc._id === 'item2'), 'index should be "item1" or "item2"');
            test.isTrue(docs.some(doc => doc._id === rDoc._id), `Should contains "${rDoc._id}"`);
            const tcDocs = getDocs(null);
            const oneDoc = getDoc(null);
            test.isTrue(tcDocs.some(doc => doc._id === oneDoc._id), `Should contains "${oneDoc._id}"`);
            stop(true);
            onComplete();
        }).catch(e => {
            console.error(e);
            test.fail(e);
            onComplete();
        });
    });

    Tinytest.addAsync('UniverseBucket - async/await', async function (test, onComplete) {
            const {getCount, ready, stop} = await bucketB.subscribe();
            test.isTrue(ready(), 'Subscribe must be ready');
            test.equal(getCount(), 3, 'Count should be 3');
            stop(true);
            onComplete();
    });

    Tinytest.addAsync('UniverseBucket - multi subscriptions', async function (test, onComplete) {
        const handler1 = await bucketA.subscribe();
        const handler2 = await bucketA.subscribe();
        test.isTrue(handler1.ready(), 'Subscribe must be ready');
        test.isTrue(handler2.ready(), 'Subscribe must be ready');
        test.equal(handler1.getCount(), handler2.getCount(), 'Numbers should be same');
        test.equal(handler1.subscriptionHash, handler2.subscriptionHash, 'Hash should be same');
        test.notEqual(handler1.subscriptionId, handler2.subscriptionId, 'Hash should be same');
        handler1.stop(true);
        test.equal(handler1.getCount(), handler2.getCount(), 'Counts should be same');
        Meteor.setTimeout(() => {
            test.equal(handler1.getCount(), handler2.getCount(), 'Numbers should be same');
            handler2.onStop(() => {
                Meteor.setTimeout(() => {
                    test.equal(handler1.getCount(), handler2.getCount(), 'Counts should be same');
                    test.equal(handler1.getCount(), 0, 'Number should be zero');
                    onComplete();
                }, 500);
            }).stop(true);

        }, 500);
    });

    Tinytest.addAsync('UniverseBucket - autorun', async function (test, onComplete) {
        const {autorun, stop, ready, onStop, getDocs, getCount} = await bucketC.subscribe();
        try {
            let isAuto = -1;
            const handler = autorun(function () {
                test.isTrue(Array.isArray(getDocs()), 'Must be an array');
                test.isTrue(ready(), 'Subscribe must be ready');
                test.equal(getCount(), this.getCount(), 'Count should be 3');
                ++isAuto;
            });

            onStop(() => {
                test.isTrue(!!isAuto, 'Autorun is not refreshed');
                onComplete();
            });

            TestCollection2.insert({title: 'taki'}, () => Meteor.setTimeout(stop, 1000));
        } catch (err) {
            test.fail(err.message || err);
        }
    });

    Tinytest.addAsync('UniverseBucket - promise in autorun', function (test, onComplete) {
        let i = 0, j = 0;
        let handler;
        const computation = Tracker.autorun(() => {
            handler = bucketC.subscribe().then(handle => {
                test.isTrue(i < handle.getCount());
                i = handle.getCount();
                ++j;
            });
        });
        Tracker.afterFlush(() => {
            TestCollection2.insert({title: 'taki2'}, () => Meteor.setTimeout(() => {
                computation.stop();
                test.isTrue(j === 1, 'Promise should be nonreactive');
                onComplete();
            }, 2000));
        });

    });

    Tinytest.addAsync('UniverseBucket - load - nonreactive', async function (test, onComplete) {
        const {getCount, stop} = await bucketD.load();
        const i = getCount();
        test.isTrue(i > 0, 'Must be something');
        TestCollection3.insert({title: 'taki2'}, () => Meteor.setTimeout(() => {
            test.equal(getCount(), i, 'should be not updated');
            stop().onStop(() => {
                Meteor.setTimeout(() => {
                    test.equal(getCount(), 0, 'should be zero');
                    onComplete();
                }, 900);
            })
        }, 900));

    });

    Tinytest.addAsync('UniverseBucket - load - observe - positive test', async function (test, onComplete) {
        const {getCount, getDoc, stop, observeCursor} = await bucketE.load();
        const doc = getDoc('testCollection4');
        Meteor.subscribe('3test', () => {
            const i = getCount();
            test.isTrue(i > 0, 'Must be something');
            observeCursor(TestCollection4.find(doc._id));
            TestCollection4.update(doc._id, {$set: {title: Random.id()}}, e => {
                if (e) {
                    test.fail(e.message||e);
                }
                const d1 = getDoc(TestCollection4, doc._id);
                const d2 = TestCollection4.findOne(doc._id);
                test.notEqual(doc.title, d1.title, 'should not be the same value');
                test.equal(d1.title, d2.title, 'should the same value');
                stop().onStop(() => {
                    onComplete();
                })
            });
        });
    });

    Tinytest.addAsync('UniverseBucket - load - observe - negative test', async function (test, onComplete) {
        const {getCount, getDoc, stop} = await bucketB.load();
        const doc = getDoc('testCollection');
        Meteor.subscribe('1test', () => {
            const i = getCount();
            test.isTrue(i > 0, 'Must be something');
            TestCollection.update(doc._id, {$set: {title: Random.id()}}, e => {
                if (e) {
                    test.fail(e.message||e);
                }
                const d1 = getDoc(TestCollection, doc._id);
                const d2 = TestCollection.findOne(doc._id);
                test.equal(doc.title, d1.title, 'should the same value');
                test.notEqual(d1.title, d2.title, 'should not be same the same value after update');
                stop().onStop(() => {
                    onComplete();
                })
            });
        });
    });

}

Tinytest.addAsync('UniverseBucket - methods', function (test, onComplete) {
    test.equal(typeof bucketB.subscribe, 'function', 'Missing subscribe function');
    test.equal(typeof bucketB.load, 'function', 'Missing subscribe function');
    onComplete();
});