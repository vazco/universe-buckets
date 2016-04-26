Package.describe({
    name: 'universe:buckets',
    version: '1.0.0',
    // Brief, one-line summary of the package.
    summary: 'Sandboxes your publication data.',
    // URL to the Git repository containing the source code for this package.
    git: '',
    // By default, Meteor will default to using README.md for documentation.
    // To avoid submitting documentation, set this field to null.
    documentation: 'README.md'
});

Package.onUse(function (api) {
    api.versionsFrom('1.3');
    api.use([
        'ecmascript',
        'underscore',
        'ejson',
        'random',
        'mongo',
        'meteor',
        'tracker',
        'universe:utilities@2.3.2',
        'check'
    ]);
    api.mainModule('buckets.js');
});

Package.onTest(function (api) {
    api.use([
        'ecmascript',
        'underscore',
        'ejson',
        'random',
        'mongo',
        'meteor',
        'tracker',
        'universe:buckets',
        'universe:utilities@2.3.2',
        'tinytest',
        'underscore',
        'test-helpers',
        'check'
    ]);
    api.addFiles('tests.js', ['client', 'server']);

});
