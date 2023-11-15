import {Definition} from '../lib/types';
import * as exposes from '../lib/exposes';
import fz from '../converters/fromZigbee';
import * as legacy from '../lib/legacy';
import tz from '../converters/toZigbee';
import * as globalStore from '../lib/store';
import * as reporting from '../lib/reporting';
import extend from '../lib/extend';
const e = exposes.presets;

const definitions: Definition[] = [
    {
        zigbeeModel: ['PU01'],
        model: '6717-84',
        vendor: 'Busch-Jaeger',
        description: 'Adaptor plug',
        extend: extend.switch(),
    },
    {
        // This converter is used for the Busch-Jaeger 6735, 6736 and 6737 devices with
        // both  6711 U (Relay) and 6715 U (dimmer) back-ends. Unfortunately both the relay and the dimmer
        // report as model 'RM01' with genLevelCtrl clusters, so we need to set up both of them
        // as dimmable lights.
        fingerprint: [
            {modelID: 'RM01', endpoints: [{ID: 10}, {ID: 18}]}, {modelID: 'RM01', endpoints: [{ID: 10}, {ID: 11}, {ID: 18}]}, {modelID: 'RM01', endpoints: [{ID: 10}, {ID: 11}, {ID: 12}, {ID: 13}, {ID: 18}]},
        ],
        model: '6735/6736/6737',
        vendor: 'Busch-Jaeger',
        description: 'Zigbee Light Link relay/dimmer',
        endpoint: (device) => {
            return {'row_1': 0x0a, 'row_2': 0x0b, 'row_3': 0x0c, 'row_4': 0x0d, 'relay': 0x12};
        },
        exposes: (device, options) => {
            const expose = [];

            expose.push(e.light_brightness().withEndpoint('relay'));
            // Exposing the device as a switch without endpoint is actually wrong, but this is the historic
            // definition and we are keeping it for compatibility reasons.
            // DEPRECATED and should be removed in the future
            expose.push(e.switch());

            // Events for row_1 will not be exposed by these devices, as row_1 is hard-wired to the relay/dimmer back-end 
            expose.push(e.action([
                'off_row_2', 'on_row_2', 'brightness_step_down_row_2', 'brightness_step_up_row_2', 'brightness_stop_row_2',
                'off_row_3', 'on_row_3', 'brightness_step_down_row_3', 'brightness_step_up_row_3', 'brightness_stop_row_3',
                'off_row_4', 'on_row_4', 'brightness_step_down_row_4', 'brightness_step_up_row_4', 'brightness_stop_row_4',
            ]));
            expose.push(e.linkquality());

            return expose;
        },
        meta: {multiEndpoint: true},
        configure: async (device, coordinatorEndpoint, logger) => {
            const endpoint18 = device.getEndpoint(0x12);
            await reporting.bind(endpoint18, coordinatorEndpoint, ['genOnOff', 'genLevelCtrl']);

            // The total number of bindings seems to be severely limited with some of these devices.
            // In order to be able to toggle groups, we need to remove the scenes cluster from RM01.
            // TODO: Do we still need this?
            const dropScenesCluster = true;

            const endpoint11 = device.getEndpoint(0x0b);
            if (endpoint11 != null) {
                if (dropScenesCluster) {
                    const index = endpoint11.outputClusters.indexOf(5);
                    if (index > -1) {
                        endpoint11.outputClusters.splice(index, 1);
                    }
                }
                await reporting.bind(endpoint11, coordinatorEndpoint, ['genLevelCtrl']);
            }
            const endpoint12 = device.getEndpoint(0x0c);
            if (endpoint12 != null) {
                if (dropScenesCluster) {
                    const index = endpoint12.outputClusters.indexOf(5);
                    if (index > -1) {
                        endpoint12.outputClusters.splice(index, 1);
                    }
                }
                await reporting.bind(endpoint12, coordinatorEndpoint, ['genLevelCtrl']);
            }
            const endpoint13 = device.getEndpoint(0x0d);
            if (endpoint13 != null) {
                if (dropScenesCluster) {
                    const index = endpoint13.outputClusters.indexOf(5);
                    if (index > -1) {
                        endpoint13.outputClusters.splice(index, 1);
                    }
                }
                await reporting.bind(endpoint13, coordinatorEndpoint, ['genLevelCtrl']);
            }
        },
        fromZigbee: [fz.ignore_basic_report, fz.on_off, fz.brightness, legacy.fz.RM01_on_click, legacy.fz.RM01_off_click,
            legacy.fz.RM01_up_hold, legacy.fz.RM01_down_hold, legacy.fz.RM01_stop],
        toZigbee: [tz.RM01_light_onoff_brightness, tz.RM01_light_brightness_step, tz.RM01_light_brightness_move],
        onEvent: async (type, data, device) => {
            const switchEndpoint = device.getEndpoint(0x12);
            if (switchEndpoint == null) {
                return;
            }
            // This device doesn't support reporting.
            // Therefore we read the on/off state from the relay/dimmer every 5 seconds.
            // This is the same way as the Hue bridge does it.
            if (type === 'stop') {
                clearInterval(globalStore.getValue(device, 'interval'));
                globalStore.clearValue(device, 'interval');
            } else if (!globalStore.hasValue(device, 'interval')) {
                const interval = setInterval(async () => {
                    try {
                        await switchEndpoint.read('genOnOff', ['onOff']);
                        await switchEndpoint.read('genLevelCtrl', ['currentLevel']);
                    } catch (error) {
                        // Do nothing
                    }
                }, 5000);
                globalStore.putValue(device, 'interval', interval);
            }
        },
    },
    {
        // This supports the battery-operated wall-switches 6735/01, 6736/01 and 6737/01 (reported as RB01)
        // as well as the Busch-Jaeger 6735, 6736 and 6737 devices on the 6710 U (Power Adapter).
        //
        // Those devices are basically just ZigBee remotes (no lights attached directly) and all rows emit events.
        //
        // In order to manually capture scenes as described in the devices manual, the endpoint
        // corresponding to the row needs to be unbound (https://www.zigbee2mqtt.io/information/binding.html)
        // If that operation was successful, the switch will respond to button presses on that
        // by blinking multiple times (vs. just blinking once if it's bound).
        fingerprint: [
            {modelID: 'RB01', endpoints: [{ID: 10}]}, {modelID: 'RB01', endpoints: [{ID: 10}, {ID: 11}]}, {modelID: 'RB01', endpoints: [{ID: 10}, {ID: 11}, {ID: 12}, {ID: 13}]},
            {modelID: 'RM01', endpoints: [{ID: 10}]}, {modelID: 'RM01', endpoints: [{ID: 10}, {ID: 11}]}, {modelID: 'RM01', endpoints: [{ID: 10}, {ID: 11}, {ID: 12}, {ID: 13}]},
        ],
        model: '6735/6736/6737',
        vendor: 'Busch-Jaeger',
        description: 'Zigbee Light Link power supply/wall-switch',
        endpoint: (device) => {
            return {'row_1': 0x0a, 'row_2': 0x0b, 'row_3': 0x0c, 'row_4': 0x0d};
        },
        exposes: (device, options) => {
            const expose = [];

            // Not all devices support all actions (depends on number of rocker rows and if relay/dimmer is installed),
            // but defining all possible actions here won't do any harm.
            expose.push(e.action([
                'off_row_1', 'on_row_1', 'brightness_step_down_row_1', 'brightness_step_up_row_1', 'brightness_stop_row_1',
                'off_row_2', 'on_row_2', 'brightness_step_down_row_2', 'brightness_step_up_row_2', 'brightness_stop_row_2',
                'off_row_3', 'on_row_3', 'brightness_step_down_row_3', 'brightness_step_up_row_3', 'brightness_stop_row_3',
                'off_row_4', 'on_row_4', 'brightness_step_down_row_4', 'brightness_step_up_row_4', 'brightness_stop_row_4',
            ]));
            expose.push(e.linkquality());

            return expose;
        },
        meta: {multiEndpoint: true},
        configure: async (device, coordinatorEndpoint, logger) => {
            // Endpoint 10 is present on all devices
            const endpoint10 = device.getEndpoint(0x0a);
            await reporting.bind(endpoint10, coordinatorEndpoint, ['genLevelCtrl']);

            const endpoint11 = device.getEndpoint(0x0b);
            if (endpoint11 != null) {
                await reporting.bind(endpoint11, coordinatorEndpoint, ['genLevelCtrl']);
            }
            const endpoint12 = device.getEndpoint(0x0c);
            if (endpoint12 != null) {
                await reporting.bind(endpoint12, coordinatorEndpoint, ['genLevelCtrl']);
            }
            const endpoint13 = device.getEndpoint(0x0d);
            if (endpoint13 != null) {
                await reporting.bind(endpoint13, coordinatorEndpoint, ['genLevelCtrl']);
            }
        },
        fromZigbee: [fz.ignore_basic_report, fz.on_off, fz.brightness, legacy.fz.RM01_on_click, legacy.fz.RM01_off_click,
            legacy.fz.RM01_up_hold, legacy.fz.RM01_down_hold, legacy.fz.RM01_stop],
        toZigbee: [tz.RM01_light_onoff_brightness, tz.RM01_light_brightness_step, tz.RM01_light_brightness_move],
    },
];

module.exports = definitions;
