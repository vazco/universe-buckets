<a href="http://unicms.io"><img src="http://unicms.io/banners/standalone.png" /></a>

# Universe Buckets
This package provides possibility of publishing documents
from various collections to bucket (sandbox).
The biggest benefit of using this package is that
you don't need to search in collection of documents
second time on client.
Additionally api of buckets brings many improvements and syntactic sugars.

## Installation
```sh
    $ meteor add universe:buckets
```
## Single bucket
This package offers you two way of working with bucket.
First one is as a single bucket instance and second gives you dictionary of buckets.
In this section we will explain how to use single instance of bucket.

### Creation of new bucket

- both sides

```js
import {Bucket} from 'meteor/universe:buckets';
var MyBucket = new Bucket('uniqueName');
```

#### `new Bucket(name, options = {})`


- On server side

```js
MyBucket.publish(function () {
   //you can return cursor, array of cursors or even array of plain objects
    return ([
        //cursor:
        Meteor.users.find(),
        //plain objects:
        [{someData: 1}, {someData: 2}]
    ]);
})
```
As you can see on example you can publish array of cursors and even **array of objects**

#### `MyBucket.publish(publishHandler, options = {condition})`

Publish api in publishHandler is fully compatible with `Meteor.publish`,
but the return can accept not only cursor or array of cursors but also array of objects,
which gives more flexible and freedom in what can be published to the clients.

Additionally in options you can pass a condition function that will checks if publication
can be processed for current user.


- On Client side

```js
MyBucket.subscribe().then(handler => {
    console.log('Ready');
    console.log('users:', handler.getDocs('users'));
    console.log('custom docs:', handler.getDocs(null));
    console.log('all in buckets:', handler.getDocs());
    console.log('admins in users:', handler.getDocs('users', {is_admin: true}, {limit:2}));
});
```


#### Using with async functions

```js
async function example () {
    const {
        getDocs,
        getCount,
        getDoc,
        ready,
        stop
    } = await MyBucket.subscribe();
    console.log('users:', getDocs('users'));
    console.log('custom docs count:', getCount(null));
    console.log('one doc:', getDoc());
    console.log('reade:', ready());
    stop().onStop(() => console.log('stopped'));
}
```

The name of subscription is omitted because we are working on bucket instance.
Of course you can pass some arguments to subscriptions as on Meteor.subscribe/Meteor.publish.


#### `MyBucket.subscribe(...params)` returns an handler object, which has:

Standard api:

- `.ready()`
- `.stop()`
- `.subscriptionId`

Extra api:

- `.then(function(handler){})`
- `.catch(function(error){})`
- `.onStop(callback)`
- `.autorun(function(computation){})`
- `.getDocs(collectionName = ALL, selector = {}, options = {})`
- `.getDoc(collectionName = ALL, selector = {}, options = {})`
- `.getCount(collectionName = ALL, selector = {}, options = {})`
- `.subscriptionHash`

#### `MyBucket.load(...params)` works as subscribe method but without tracking of changes (non-reactive).
This is good option for long listings where performance is more important than reactivity of items. 

Of course you can ask why not use just a meteor call (rpc method) instead of that.
The answer is simple, Bucket api give you possibility of:

- searching in those data (using mongo selectors)
- you can write just one publish method for both functionalities (subscribe / load)
- load method gives you possibility of adding reactivity for selected documents in bucket. It means that some of items in your listing still can be reactive. 

##### load method returns the handle, which is pretty much same like this one returned by subscribe:

Standard api:

- `.ready()`
- `.stop()`
- `.subscriptionId`

Extra api:

- `.then(function(handler){})`
- `.catch(function(error){})`
- `.onStop(callback)`
- `.autorun(function(computation){})`
- `.getDocs(collectionName = ALL, selector = {}, options = {})`
- `.getDoc(collectionName = ALL, selector = {}, options = {})`
- `.getCount(collectionName = ALL, selector = {}, options = {})`
- `.subscriptionHash`
- `.isStatic: true`
- `.observeCursor(cursor)`
- `.refresh()`

#### Adding reactivity for some documents in bucket

```js
//both sides:
const usersBucket = new Bucket('usersBucket');
if (Meteor.isServer) {
    usersBucket.publish(function() {
        return Meteor.users.find();
    });
}
// client:
(async function () {
        const {getDoc, getDocs, observeCursor} = await usersBucket.load();
        const loggedInId = Meteor.userId();
        observeCursor(Meteor.users.find(loggedInId));
        //will be reactive
        const user1 = getDoc('users', loggedInId);
        // will be nonreactive
        const user2 = getDoc('users', 'otherId');

        // Will be reactive only for one user
        const allDocs = getDocs();
})
```


### Extra stuff in handler
As you can see bucket handlers have additional stuff.
So, any time when you call bucket.subscribe or bucket.load,
you will get a handler which contains standard api but also handler can be treat as a promise (it mean, there are available then/catch methods on it)

additionally you can find methods like autorun which is bound with life cycle of subscription (subscribe - stop).

Of course there are methods to gets data from buckets like getDocs/getDoc/getCount.

besides methods, there are few properties like subscriptionHash
witch is same for subscription of buckets with the same parameters. 


### Creation of collections of buckets
> to be continued soon

License MIT
