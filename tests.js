import {Bucket} from 'meteor/universe:buckets';
const TestCollection = new Mongo.Collection('testCollection');
const TestCollection2 = new Mongo.Collection('testCollection2');
TestCollection2.allow({insert: () => true});
const TestCollection3 = new Mongo.Collection('testCollection3');
TestCollection3.allow({insert: () => true});

const bucketA = new Bucket('bucketA');
const bucketB = new Bucket('bucketB');
const bucketC = new Bucket('bucketC');
const bucketD = new Bucket('bucketD');

TestCollection.allow({
    insert: () => true,
    update: () => true,
    remove: () => true
});

if (Meteor.isServer) {

    TestCollection.remove({_id: {$exists: true}});
    TestCollection.insert({field1: 'a', _id: 'item1'});
    TestCollection.insert({field1: 'b', _id: 'item2'});
    TestCollection.insert({field1: 'c', _id: 'item3'});
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
        return [TestCollection.find(), TestCollection2.find()];
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
                console.log(isAuto);
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
            }, 1000));
        });

    });

    Tinytest.addAsync('UniverseBucket - load', async function (test, onComplete) {
        const {getCount, stop} = await bucketC.load();
        const i = getCount();
        test.isTrue(getCount() > 0, 'Must be something');
        TestCollection3.insert({title: 'taki2'}, () => Meteor.setTimeout(() => {
            console.log(getCount());
            test.isTrue(getCount() === i);
            stop();
            onComplete();
        }, 1000));


    });

}

