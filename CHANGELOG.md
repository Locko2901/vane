# Changelog

## [1.3.0](https://github.com/Locko2901/vane/compare/v1.2.2...v1.3.0) (2026-09-27)


### Features

* **srv:** add the /api/srv routes ([ae6b7ba](https://github.com/Locko2901/vane/commit/ae6b7ba3d5d689f97cd2c37442393feb08ca6161))
* **srv:** add the SRV records page ([4a80cdd](https://github.com/Locko2901/vane/commit/4a80cdd0abcc8127d854fce1db88aa3f2d632856))
* **srv:** show SRV records in health, backups and the token list ([92ae71f](https://github.com/Locko2901/vane/commit/92ae71f9e4bcb797db0e1fb7fb4b97bfdcc58b27))
* **srv:** store SRV records and sync them straight to Cloudflare ([f89fd56](https://github.com/Locko2901/vane/commit/f89fd56e66ace3e428cb04efc06f3bb74dd97074))


### Documentation

* **srv:** document SRV records in the README ([cc4fe95](https://github.com/Locko2901/vane/commit/cc4fe9564bc058aca7a8e3a76d30c5eb8bb577a2))


### Tests

* **srv:** pin the SRV API contract, sync rules and cleanup ([734dcc0](https://github.com/Locko2901/vane/commit/734dcc0a52fb68030f32b16a68b969e8af9c355b))

## [1.2.2](https://github.com/Locko2901/vane/compare/v1.2.1...v1.2.2) (2026-09-24)


### Bug Fixes

* **dashboard:** check every enabled host in Record Health ([0bf448c](https://github.com/Locko2901/vane/commit/0bf448c1f473eb985b2a196d98d9442fdc27cef3))

## [1.2.1](https://github.com/Locko2901/vane/compare/v1.2.0...v1.2.1) (2026-09-22)


### Bug Fixes

* **cloudflare:** sync proxy status onto existing DNS records on apply ([7a92293](https://github.com/Locko2901/vane/commit/7a92293f69c4de942560728ba8a9a71e0cd9860c))


### Miscellaneous

* remove ddns-manager remnant of the pre-rename tree ([544c95e](https://github.com/Locko2901/vane/commit/544c95e2270b533ff3f71968a2b5d8e9f7f177e3))

## [1.2.0](https://github.com/Locko2901/vane/compare/v1.1.2...v1.2.0) (2026-08-17)


### Features

* **hosts:** group by zone with collapsible sections and compact view ([e8c92af](https://github.com/Locko2901/vane/commit/e8c92afc1c61330d97c4da886ed797522306d6f6))
* **routes:** add route imports and prefetch function for dynamic loading ([517c3d6](https://github.com/Locko2901/vane/commit/517c3d6b8d62dcb4739982fa568860b11783eb3b))


### Bug Fixes

* **frontend:** correct template literal indentation flagged by eslint ([7f4776a](https://github.com/Locko2901/vane/commit/7f4776a694bb6ecbb8aa800a82b8ec37aa2fc6ba))


### Documentation

* **readme:** clarify Vane only runs as a container with the DDNS container ([076be96](https://github.com/Locko2901/vane/commit/076be9696a94065ddcab3dd8cfbcd600bfc13efc))


### Build System

* **deps-dev:** bump the backend-dev group across 1 directory with 5 updates ([#29](https://github.com/Locko2901/vane/issues/29)) ([67019f2](https://github.com/Locko2901/vane/commit/67019f2d5e5417d982dfed21992342fa51e9b8f0))
* **deps-dev:** bump the frontend-dev group ([#30](https://github.com/Locko2901/vane/issues/30)) ([3e4e91b](https://github.com/Locko2901/vane/commit/3e4e91b73ba7eda8ed89f8ae281c1ec490b48906))


### CI

* **dependabot:** ignore TypeScript 7 and Tailwind 4 majors ([5ed54de](https://github.com/Locko2901/vane/commit/5ed54de7cc7ee6f25ee837ac28378db3478d8725))


### Styles

* **ui:** refresh design system across the app ([72e396d](https://github.com/Locko2901/vane/commit/72e396da65b8feab81f2365e8c1de4060b56606f))

## [1.1.2](https://github.com/Locko2901/vane/compare/v1.1.1...v1.1.2) (2026-08-10)


### Bug Fixes

* make Vane dev stack and mobile layout responsive ([219b706](https://github.com/Locko2901/vane/commit/219b7060b0c19dc8b3352bc95322b58d9a323494))
* resolve  lint issues ([5e6f547](https://github.com/Locko2901/vane/commit/5e6f547a9479e15d0b02e2b6dc72dde7addf19c0))
* resolve linting issues ([89526eb](https://github.com/Locko2901/vane/commit/89526eb4aca467948173c8fbe46f33cdbe43352b))


### Tests

* add frontend and backend test coverage for app flows, API client, and backup logic ([efb321f](https://github.com/Locko2901/vane/commit/efb321f174cc0562ee6f7c189c227fe772e6db7c))

## [1.1.1](https://github.com/Locko2901/vane/compare/v1.1.0...v1.1.1) (2026-07-28)


### Bug Fixes

* use Express 5 named wildcard for SPA catch-all route ([aa59a74](https://github.com/Locko2901/vane/commit/aa59a74d10a344ad866f2c3391dc9b307e7148d0))

## [1.1.0](https://github.com/Locko2901/vane/compare/v1.0.0...v1.1.0) (2026-07-28)


### Features

* initial release of Vane ([aae8047](https://github.com/Locko2901/vane/commit/aae8047903948d6f542fbaef33fc498e33b79876))


### Bug Fixes

* **deps:** patch uuid and react-router advisories ([470412b](https://github.com/Locko2901/vane/commit/470412b37f6ee0b59cf9855841c5ee87fc8d5780))
* **deps:** pin typescript & tailwind to supported majors, fix CI ([dce8c12](https://github.com/Locko2901/vane/commit/dce8c12b8c8b9b8089ab8a736365b6882345a6a6))
* **deps:** resolve typescript-eslint peer conflict with legacy-peer-deps ([62699da](https://github.com/Locko2901/vane/commit/62699dad45adb572fc8aa07c7e79eeb32e63d6a2))


### Documentation

* link Contributing section to CONTRIBUTING, CODE_OF_CONDUCT, and SECURITY ([170d5e9](https://github.com/Locko2901/vane/commit/170d5e9b3976fbb49a44eebf01819755ece81566))


### Build System

* **deps-dev:** bump brace-expansion in /vane/backend ([#4](https://github.com/Locko2901/vane/issues/4)) ([b4621c7](https://github.com/Locko2901/vane/commit/b4621c71343dc49fe1b99c43e7b0eb5da60ccdf0))
* **deps-dev:** bump brace-expansion in /vane/frontend ([#3](https://github.com/Locko2901/vane/issues/3)) ([86a3437](https://github.com/Locko2901/vane/commit/86a34373ce57e982e2dfca1bf9aa3de356170a45))
* **deps-dev:** bump js-yaml from 4.2.0 to 4.3.0 in /vane/backend ([#11](https://github.com/Locko2901/vane/issues/11)) ([c7f5e23](https://github.com/Locko2901/vane/commit/c7f5e23ce5e555f199de1850fd3a75b6c860f494))
* **deps-dev:** bump js-yaml from 4.2.0 to 4.3.0 in /vane/frontend ([#8](https://github.com/Locko2901/vane/issues/8)) ([5f06286](https://github.com/Locko2901/vane/commit/5f062865c10d4228fb15df1c0e19de2b59de0007))
* **deps-dev:** bump postcss from 8.5.15 to 8.5.24 in /vane/frontend ([#10](https://github.com/Locko2901/vane/issues/10)) ([a624406](https://github.com/Locko2901/vane/commit/a62440644f31dd822694ea5f0d7da22aac5d8146))
* **deps-dev:** bump the backend-dev group across 1 directory with 9 updates ([#18](https://github.com/Locko2901/vane/issues/18)) ([0e9cca6](https://github.com/Locko2901/vane/commit/0e9cca653f5978bbe8ecb158ca08ddbb884d3570))
* **deps-dev:** bump the frontend-dev group across 1 directory with 12 updates ([#17](https://github.com/Locko2901/vane/issues/17)) ([314694c](https://github.com/Locko2901/vane/commit/314694c2c672962960686979be56cabf705af51e))
* **deps:** bump body-parser and express in /vane/backend ([#16](https://github.com/Locko2901/vane/issues/16)) ([0f4eb34](https://github.com/Locko2901/vane/commit/0f4eb34851e1ec72f9e8080d2a6a137464f08c71))
* **deps:** bump body-parser from 1.20.5 to 1.20.6 in /vane/backend ([#6](https://github.com/Locko2901/vane/issues/6)) ([65d2828](https://github.com/Locko2901/vane/commit/65d2828c61b6610abd1745bcdbacad9a2e7d3ce4))
* **deps:** bump node from 22-alpine to 26-alpine in /vane ([#2](https://github.com/Locko2901/vane/issues/2)) ([a891268](https://github.com/Locko2901/vane/commit/a891268dfa190014da9bc85cb40751219e95c8f8))
* **deps:** bump protobufjs from 7.6.4 to 7.6.5 in /vane/backend ([#9](https://github.com/Locko2901/vane/issues/9)) ([bab96ca](https://github.com/Locko2901/vane/commit/bab96caaa2eae67b2c8ecad475b1aa10dab84e85))
* **deps:** bump react-router-dom in /vane/frontend ([#5](https://github.com/Locko2901/vane/issues/5)) ([4875369](https://github.com/Locko2901/vane/commit/48753697b6f6e90429115c7c6886e126876db024))
* **deps:** bump the frontend-prod group across 1 directory with 4 updates ([#13](https://github.com/Locko2901/vane/issues/13)) ([f26eb18](https://github.com/Locko2901/vane/commit/f26eb18d39810ea4c4405effb79357fa9cdfe960))


### CI

* **deps:** bump the github-actions group with 2 updates ([#1](https://github.com/Locko2901/vane/issues/1)) ([a12b1e4](https://github.com/Locko2901/vane/commit/a12b1e4ebf700e230f208123a6289064c9fe6f8c))
