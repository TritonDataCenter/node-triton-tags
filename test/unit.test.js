/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2021, Joyent, Inc.
 */

/*
 * Unit tests for "triton-tags"
 */

var format = require('util').format;
var test = require('tape');
var vasync = require('vasync');

var triton_tags = require('../');


// ---- test data

/*
 * `parseTritonTagStr` tests use key, str, val and err
 * `validateTritonTag` tests use key, val (or str if `val` isn't set) and
 *      errmsg (or `err` if errmsg isn't set)
 *
 */
var cases = [
    // Basics:
    {
        key: 'triton._test.string',
        str: 'astr',
        val: 'astr'
    },
    {
        key: 'triton._test.string',
        str: '',
        val: ''
    },
    {
        key: 'triton._test.boolean',
        str: 'true',
        val: true
    },
    {
        key: 'triton._test.boolean',
        str: 'false',
        val: false
    },
    {
        key: 'triton._test.number',
        str: '42',
        val: 42
    },

    // Some type failures:
    {
        key: 'triton._test.boolean',
        str: 'not a bool',
        /* JSSTYLED */
        err: /Triton tag "triton._test.boolean" value must be "true" or "false": "not a bool"/,
        /* JSSTYLED */
        errmsg: /Triton tag "triton._test.boolean" value must be a boolean: "not a bool"/
    },
    {
        key: 'triton._test.number',
        str: 'not a num',
        /* JSSTYLED */
        err: /Triton tag "triton._test.number" value must be a number: "not a num"/
    },
    {
        key: 'triton._test.number',
        str: '',
        /* JSSTYLED */
        err: /Triton tag "triton._test.number" value must be a number: ""/
    },

    // Unknown tag:
    {
        key: 'triton.unknown',
        str: '',
        /* JSSTYLED */
        err: /Unrecognized special triton tag \"triton.unknown\"/
    },

    // triton.cmon.groups
    {
        key: 'triton.cmon.groups',
        str: '',
        /* JSSTYLED */
        err: /invalid \"triton.cmon.groups\" tag: group name must be no less than 1 character and no greater than 100 characters/
    },
    {
        key: 'triton.cmon.groups',
        str: '&(--',
        /* JSSTYLED */
        err: /invalid \"triton.cmon.groups\" tag: groups must be strings comprised of letters, numbers, _, and -/
    },
    {
        key: 'triton.cmon.groups',
        /* JSSTYLED */
        str: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101',
        /* JSSTYLED */
        err: /invalid "triton.cmon.groups" tag: must contain less than or equal to 100 group strings/
    },
    {
        key: 'triton.cmon.groups',
        /* JSSTYLED */
        str: 'nifjdwhctkxbyhdqtwifkmehiedqocmmbguukckllseyirkedddrhmqmaemwfczfisvpmhunykccavpxqenpegbymhibsdazfmrrc',
        /* JSSTYLED */
        err: /invalid "triton.cmon.groups" tag: group name must be no less than 1 character and no greater than 100 characters/
    },
    {
        key: 'triton.cmon.groups',
        str: 'a,b,c,dupe,z,dupe,x',
        /* JSSTYLED */
        err: /invalid \"triton.cmon.groups\" tag: contains duplicate group dupe/
    },
    {
        key: 'triton.cmon.groups',
        str: 'foo-bar,bar_foo,disc',
        val: 'foo-bar,bar_foo,disc'
    },

    // triton.cns.disable
    {
        key: 'triton.cns.disable',
        str: 'true',
        val: true
    },
    {
        key: 'triton.cns.disable',
        str: 'false',
        val: false
    },
    {
        key: 'triton.cns.disable',
        str: 'booga',
        /* JSSTYLED */
        err: /Triton tag "triton.cns.disable" value must be "true" or "false": "booga"/,
        /* JSSTYLED */
        errmsg: /Triton tag "triton.cns.disable" value must be a boolean: "booga"/
    },

    {
        key: 'triton.cns.services',
        str: '',
        err: /Expected DNS name but end of input found/
    },
    {
        key: 'triton.cns.services',
        str: 'foobar',
        val: 'foobar'
    },
    {
        key: 'triton.cns.services',
        str: '_foobar',
        /* JSSTYLED */
        err: /Expected DNS name but "_" found/
    },
    {
        key: 'triton.cns.services',
        str: 'foobar:1234',
        val: 'foobar:1234'
    },
    {
        key: 'triton.cns.services',
        str: 'foobar,test',
        val: 'foobar,test'
    },
    {
        key: 'triton.cns.services',
        str: 'foobar.dev:123',
        val: 'foobar.dev:123'
    },
    {
        key: 'triton.cns.services',
        str: 'foobar:1234,test:1234',
        val: 'foobar:1234,test:1234'
    },
    {
        key: 'triton.cns.services',
        str: 'foobar:abcd',
        /* JSSTYLED */
        err: /Expected "=" but end of input found/
    },
    {
        key: 'triton.cns.services',
        str: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        err: /63 or fewer characters/
    },
    {
        key: 'triton.cns.services',
        str: 'foobar:123123123123',
        err: /must be within the range 1 - 65535/
    },
    {
        key: 'triton.cns.services',
        str: 'foobar:1234:priority=10',
        val: 'foobar:1234:priority=10'
    },
    {
        key: 'triton.cns.services',
        str: 'foobar:port=1234',
        val: 'foobar:port=1234'
    },
    {
        key: 'triton.cns.services',
        str: 'foobar:invalid=somevalue1',
        err: /not a valid property name/
    },
    {
        key: 'triton.cns.services',
        str: 'foobar:priority=aaaaaaa',
        err: /must be within the range 0 - 65535/
    },
    {
        key: 'triton.cns.services',
        str: '5foobar',
        val: '5foobar'
    },
    // _service._protocol support
    {
        key: 'triton.cns.services',
        str: '_ldap._tcp:389',
        val: '_ldap._tcp:389'
    },
    {
        key: 'triton.cns.services',
        str: '_dns._udp:389',
        val: '_dns._udp:389'
    },
    {
        key: 'triton.cns.services',
        str: '_foo._tcp:123:priority=20:weight=20',
        val: '_foo._tcp:123:priority=20:weight=20'
    },
    {
        key: 'triton.cns.services',
        str: '_foo._bar:389',
        /* JSSTYLED */
        err: /Expected DNS name but "_" found/
    },
    {
        key: 'triton.cns.services',
        str: '_tcp:389',
        /* JSSTYLED */
        err: /Expected DNS name but "_" found/
    }

    // TODO: triton.cns.reverse_ptr
];


// ---- tests

test('isTritonTag', function (t) {
    var isTritonTag = triton_tags.isTritonTag;

    [
        'triton.foo',
        'triton.cns.disable'
    ].forEach(function (key) {
        t.equal(isTritonTag(key), true, 'is a triton tag: ' + key);
    });

    [
        'Triton.foo',
        'cns.disable',
        ''
    ].forEach(function (key) {
        t.equal(isTritonTag(key), false, 'is not a triton tag: ' + key);
    });

    t.end();
});


test('parseTritonTagStr', function (t) {
    var parseTritonTagStr = triton_tags.parseTritonTagStr;

    vasync.forEachPipeline({
        inputs: cases,
        func: function testOneCase(c, next) {
            parseTritonTagStr(c.key, c.str, function (err, val) {
                var name = format('parseTritonTagStr(%j, %j)',
                    c.key, c.str);
                if (c.err) {
                    t.ok(err, name + ' (expect err)');
                    t.ok(c.err.exec(err.message), format(
                        'err.message matches %s: %j', c.err, err.message));
                    t.ok(val === undefined);
                } else {
                    t.ifErr(err, name);
                    t.equal(val, c.val, 'val');
                }
                next();
            });
        }
    }, function (err) {
        t.ifErr(err, 'parseTritonTagStr cases');
        t.end();
    });
});

test('validateTritonTag', function (t) {
    var validateTritonTag = triton_tags.validateTritonTag;

    vasync.forEachPipeline({
        inputs: cases,
        func: function testOneCase(c, next) {
            var val = (c.hasOwnProperty('val') ? c.val : c.str);
            var name = format('validateTritonTag(%j, %j)', c.key, val);
            var errmsg = validateTritonTag(c.key, val);
            if (c.errmsg || c.err) {
                t.ok(errmsg, name + ' (expect err)');
                t.ok((c.errmsg || c.err).exec(errmsg), format(
                    'errmsg matches %s: %j', (c.errmsg || c.err), errmsg));
            } else {
                t.ifErr(errmsg, name);
            }
            next();
        }
    }, function (err) {
        t.ifErr(err, 'validateTritonTag cases');
        t.end();
    });
});

var parser = require('../lib/cns-svc-tag');
test('cns services tag regressions', function (t) {
    /* CNS-152 */
    t.deepEqual(parser.parse('foo.dev,test.dev'), [
        { name: 'foo.dev' }, { name: 'test.dev' }
    ]);
    /* CNS-153 */
    t.deepEqual(parser.parse('someName'), [
        { name: 'somename' }
    ]);
    t.end();
});
