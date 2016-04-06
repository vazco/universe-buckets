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
var MyBucket = new Bucket('uniqueName');
```

#### `new Bucket(name, options = {})`


- On server side

```js
MyBucket.publish(() => [
    Meteor.users.find(),
    [{someData: 1}, {someData: 2}]
])
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
    console.log('custom docs:', handler.getDocs('uniqueName'));
    console.log('all in buckets:', handler.getDocs());
    console.log('admins in users:', handler.getDocs('users', {is_admin: true}, {limit:2}));
});
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
