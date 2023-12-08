/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2019, Joyent, Inc.
 */

/*
 * In Triton some per-VM configuration is controlled via special structured
 * tags on the VM's "tags" object. They are all prefixed with "triton.".
 * Let's call them "Triton tags".
 *
 * Triton tags are all optional.
 *
 * - `triton.cmon.groups` (string): Comma-separated list of CMON group strings
 *   used to filter the set of results returned by the CMON discover endpoint
 *   (e.g. Request that only VMs with tag 'triton.cmon.groups=api' be returned).
 * - `triton.cns.disable` (boolean): Can be set on a VM to tell the CNS service
 *   to not serve records for this VM.
 * - `triton.cns.services` (string): Comma-separated list of DNS-name strings
 *   for the CNS service.
 * - `triton.cns.reverse_ptr` (string): DNS reverse pointer for this VM. Used
 *   by the CNS service.
 * - `triton.network.public` (string): Set on a VM, used to specify the external
 *   network name a VM will use.
 * - `triton.placement.exclude_virtual_servers` (boolean): Set on a VM, used to
 *   tell DAPI to ignore virtual servers when provisioning (e.g. mockcloud).
 */

var assert = require('assert-plus');
var format = require('util').format;
var cmonGroupsTag = require('./cmon-groups-tag');
var cnsSvcTag = require('./cns-svc-tag');

/*
 * For now, using the more limited labels allowed by RFC1123. RFC2181 supercedes
 * 1123, but the broader range of characters can sometimes cause problems with
 * other systems (e.g. see the underscore in RFC5321).
 */
var DNS_NAME_RE = /^[a-z0-9][a-z0-9\-]{0,62}(?:\.[a-z0-9][a-z0-9\-]{0,62})*$/i;


/*
 * The value 100 is somewhat arbitrary, but was chosen as a limit on the number
 * of gropus and length of group names. The reasoning is that it is likely high
 * enough to not be hit, but low enough to not allow massive group counts and
 * group names that could potentially chew up DRAM in the CMON cache.
 */
var CMON_MAX_GROUPS = 100;
var CMON_MAX_GROUP_LEN = 100;


var typeFromKey = {
    'triton.cmon.groups': 'string',
    'triton.cns.services': 'string',
    'triton.cns.disable': 'boolean',
    'triton.cns.reverse_ptr': 'string',
    'triton.network.public': 'string',
    'triton.network.public_ipv4': 'string',
    'triton.placement.exclude_virtual_servers': 'boolean',

    // Internal testing Triton tags
    'triton._test.string': 'string',
    'triton._test.number': 'number',
    'triton._test.boolean': 'boolean'
};

/*
 * Validator functions take a `val` (already checked to be of the appropriate
 * type per `typeFromKey`) and return an error message if invalid. If valid,
 * null is returned.
 */
var validatorFromKey = {
    'triton.cmon.groups': function validateTritonCmonGroups(val) {
        assert.string(val, 'val');

        var groups;
        try {
            groups = cmonGroupsTag.parse(val);
        } catch (e) {
            return format(
                'invalid "triton.cmon.groups" tag: groups must be strings ' +
                'comprised of letters, numbers, _, and -');
        }

        assert.arrayOfString(groups);

        if (groups.length < 1) {
            return format(
                'invalid "triton.cmon.groups" tag: must contain at least ' +
                'one valid group string');
        }

        if (groups.length > CMON_MAX_GROUPS) {
            return format(
                'invalid "triton.cmon.groups" tag: must contain less than ' +
                'or equal to 100 group strings');
        }

        var tagCount = {};
        for (var i = 0; i < groups.length; ++i) {
            var group = groups[i];
            assert.string(group);

            if (tagCount[group] !== 1) {
                tagCount[group] = 1;
            } else {
                return format('invalid "triton.cmon.groups" tag: contains ' +
                    'duplicate group %s', group);
            }

            if (group.length < 1 || group.length > CMON_MAX_GROUP_LEN) {
                return format(
                    'invalid "triton.cmon.groups" tag: group name must be no ' +
                    'less than 1 character and no greater than 100 characters');
            }
        }

        return null;
    },

    'triton.cns.services': function validateTritonCnsServices(val) {
        assert.string(val, 'val');

        var svcs;
        try {
            svcs = cnsSvcTag.parse(val);
        } catch (e) {
            return format(
                'invalid "triton.cns.services" tag: %s', e.message);
        }
        assert.arrayOfObject(svcs);
        if (svcs.length < 1) {
            return format(
                'invalid "triton.cns.services" tag: must contain at least ' +
                'one valid service');
        }

        for (var i = 0; i < svcs.length; ++i) {
            var svc = svcs[i];
            assert.string(svc.name);
            if (svc.name.length < 1 || svc.name.length > 63) {
                return format(
                    'invalid "triton.cns.services" tag: service DNS name ' +
                    '"%s" must be 63 or fewer characters',
                    svc.name);
            }
            if (svc.port !== undefined) {
                svc.port = parseInt(svc.port, 10);
                if (isNaN(svc.port) || svc.port < 1 || svc.port > 65535) {
                    return format(
                        'invalid "triton.cns.services" tag: service port ' +
                        'number for %s must be within the range 1 - 65535',
                        svc.name);
                }
            }
            var keys = Object.keys(svc);
            for (var j = 0; j < keys.length; ++j) {
                if (keys[j] === 'name' || keys[j] === 'port') {
                    continue;

                } else if (keys[j] === 'priority' || keys[j] === 'weight') {
                    svc[keys[j]] = parseInt(svc[keys[j]], 10);

                    if (isNaN(svc[keys[j]]) || svc[keys[j]] < 0 ||
                        svc[keys[j]] > 65535) {

                        return format(
                            'invalid "triton.cns.services" tag: service ' +
                            '%s for %s must be within the range 0 - 65535',
                            keys[j], svc.name);
                    }

                    continue;

                } else {
                    return format(
                        'invalid "triton.cns.services" tag: service property ' +
                        '"%s" is not a valid property name', keys[j]);
                }
            }
        }

        return null;
    },

    'triton.cns.disable': function validateTritonCnsDisable(val) {
        assert.bool(val, 'val');

        // In other words, basically a no-op.
        return null;
    },

    'triton.cns.reverse_ptr': function validateTritonCnsReversePtr(val) {
        assert.string(val, 'val');

        if (val.length > 255 || !val.match(DNS_NAME_RE)) {
            return format(
                'invalid "triton.cns.reverse_ptr" tag: "%s" is not DNS safe',
                val);
        }

        return null;
    },

    'triton.network.public': function validateTritonNetworkPublic(val) {
        assert.string(val, 'val');
        return null;
    },

    'triton.network.public_ipv4': function validateTritonNetworkPublicIpv4(val) {
        assert.string(val, 'val');
        return null;
    },

    'triton.placement.exclude_virtual_servers':
            function validateTritonExcludeVirtualServersBoolean(val) {
        assert.bool(val, 'val');
        return null;
    },

    /*
     * Triton tags used for internal testing.
     */
    'triton._test.string': function validateTritonTestString(val) {
        assert.string(val, 'val');
        return null;
    },
    'triton._test.number': function validateTritonTestNumber(val) {
        assert.number(val, 'val');
        return null;
    },
    'triton._test.boolean': function validateTritonTestBoolean(val) {
        assert.bool(val, 'val');
        return null;
    }
};



// --- exports

/*
 * Return true if the given key uses the Triton tag prefix.
 * Note that it still might not be one of the specific defined tags.
 */
function isTritonTag(key) {
    assert.string(key, 'key');
    const TRITON_TAG_PREFIX = 'triton.';
    return (key.substr(0, TRITON_TAG_PREFIX.length) === TRITON_TAG_PREFIX);
}


/**
 * Parse a Triton tag from the given string value.
 *
 * @param {String} key: The Triton tag key/name.
 * @param {String} str: The tag value to parse.
 * @param {Function} cb: `function (err, val)`
 *      On success, `err` is null and `val` is the parsed and validated
 *      tag value. On failure `err` is an Error instance.
 */
function parseTritonTagStr(key, str, cb) {
    assert.string(key, 'key');
    assert.string(str, 'str');
    assert.func(cb, 'cb');

    // Ensure it is a known triton tag.
    var type = typeFromKey[key];
    if (type === undefined) {
        cb(new Error(format('Unrecognized special triton tag "%s"', key)));
        return;
    }

    // Convert from string to value of appropriate type.
    var val;
    switch (type) {
    case 'string':
        val = str;
        break;
    case 'boolean':
        if (str === 'true') {
            val = true;
        } else if (str === 'false') {
            val = false;
        } else {
            cb(new Error(format(
                'Triton tag "%s" value must be "true" or "false": %j',
                key, str)));
            return;
        }
        break;
    case 'number':
        val = Number(str);
        if (str.length === 0 || /* Guard against `Number('') === 0` wat. */
            isNaN(val))
        {
            cb(new Error(format('Triton tag "%s" value must be a number: %j',
                key, str)));
            return;
        }
        break;
    default:
        throw new Error('unexpected Triton tag type: ' + type);
    }

    // Validate.
    var validator = validatorFromKey[key];
    assert.func(validator, 'validator for tag ' + key);
    var errmsg = validator(val);

    if (errmsg) {
        cb(new Error(errmsg));
    } else {
        cb(null, val);
    }
}


/**
 * Validate the given Triton tag key and value.
 *
 * This differs from `parseTritonTagStr` in that the `val` argument should
 * already be of the correct type, and no value is returned.
 *
 * @param {String} key
 * @param {String|Number|Boolean} val
 * @returns {null|String} If valid, `null` is returned. Otherwise an error
 *      message is returned.
 */
function validateTritonTag(key, val) {
    assert.string(key, 'key');

    // Check type.
    var expectedType = typeFromKey[key];
    var actualType = typeof (val);
    if (expectedType === undefined) {
        return format('Unrecognized special triton tag "%s"', key);
    } else if (expectedType !== actualType) {
        return format('Triton tag "%s" value must be a %s: %j (%s)',
            key, expectedType, val, actualType);
    }

    // Validate.
    var validator = validatorFromKey[key];
    assert.func(validator, 'validator for tag ' + key);
    return validator(val);
}



module.exports = {
    isTritonTag: isTritonTag,
    parseTritonTagStr: parseTritonTagStr,
    validateTritonTag: validateTritonTag
};
