# node-triton-tags changelog

## not yet released

(nothing yet)

## 1.5.0

- TRITON-2497 Static IP support for sdc-docker (new tag type)

## 1.4.1

- Remove git:// URLs.

## 1.4.0

- triton-cns#25: Better support for SRV records

## 1.3.0

- TRITON-1242: Add `triton.placement.exclude_virtual_servers` boolean tag. This
  is used to tell DAPI to filter out virtual servers (e.g. mockcloud).

## 1.2.2

- TRITON-755 Fix the release process (`make cutarelease`) to ensure pegjs files
  are built and included in the published files.

## 1.2.1

- TRITON-755: Fix missing peg.js generated files

## 1.2.0

- TRITON-755: Add support for 'triton.cmon.groups' tag. This tag is used for
  filtering the set of results returned by the CMON discover endpoint.

## 1.1.4

- DOCKER-1020: Add 'triton.network.public' tag

## 1.1.3

- joyent/node-triton-tags#2: allow DNS names to start with a number. Even
  though this is not recommended by the DNS RFCs, in practice it is used
  fairly commonly (including by a number of major websites)

## 1.1.2

- CNS-153: Upper case in services tags stopped working (another unplanned
  feature)

## 1.1.1

- CNS-152: allowing periods in service names: an unplanned feature

## 1.1.0

- CNS-147: new PEG parser for triton.cns.services tag, so this can be
  shared with triton-cns as well. Now supports ports for SRV records and
  extensible properties.

## 1.0.0

- DOCKER-736 Initial release.
