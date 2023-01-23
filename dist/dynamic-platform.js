"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const enet_api_1 = require("enet-api");
const fs_1 = __importDefault(require("fs"));
const { version } = require("../package.json");
const PLUGIN_NAME = "homebridge-enet";
const PLATFORM_NAME = "eNetPlatform";
let hap;
let Accessory;
class ENetPlatform {
    constructor(log, config, api) {
        this.accessories = [];
        this.devices = {};
        this.log = log;
        this.api = api;
        this.config = config;
        this.log.info(`eNet start initializing!`);
        const path = `${this.api.user.storagePath()}/.enet`;
        if (!fs_1.default.existsSync(path)) {
            fs_1.default.writeFileSync(path, JSON.stringify({ token: null }), { encoding: "utf8" });
        }
        var token = null;
        try {
            token = JSON.parse(fs_1.default.readFileSync(path, { encoding: "utf8" })).token;
        }
        catch (error) { }
        if (token === null) {
            this.enet = new enet_api_1.ENet['default'](config.host);
            this.log.info("Authentication needed!");
            this.enet.authenticate(this.config.username, this.config.password)
                .then((token) => {
                fs_1.default.writeFileSync(path, JSON.stringify({ token }), { encoding: "utf8" });
                this.setupNow();
            })
                .catch((error) => {
                this.log.error(error.message);
            });
        }
        else {
            this.enet = new enet_api_1.ENet['default'](config.host, token);
            this.setupNow();
        }
        // Handle polling
        const interval = typeof config.interval === "number" ? config.interval : 10;
        if (interval >= 3) {
            setInterval(() => {
                this.poll();
            }, interval * 1000);
        }
    }
    setupNow() {
        return new Promise(async (resolve, reject) => {
            try {
                const devices = await this.enet.getDevices();
                this.log.info(devices);
                for (let device of devices) {
                    const uuid = device.deviceUID.toLowerCase();
                    delete device.deviceUID;
                    this.devices[uuid] = device;
                    this.devices[uuid].state = null;
                    if (!this.accessories.find(accessory => accessory.UUID === uuid)) {
                        const accessory = new this.api.platformAccessory(device.locationName, uuid);
                        accessory.addService(hap.Service.Switch, device.locationName);
                        this.accessories.push(accessory);
                        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                    }
                }
                resolve();
            }
            catch (error) {
                reject(error.message);
            }
        });
    }
    poll() {
        for (const deviceUID in this.devices) {
            this.enet.getDevicePrimaryState(deviceUID).then((res) => {
                this.devices[deviceUID].state = res;
            });
        }
    }
    configureAccessory(accessory) {
        (async () => {
            this.log.info(`Configuring '${accessory.UUID}'`);
            const device = await this.enet.getDeviceInfo(accessory.UUID);
            accessory.on("identify" /* IDENTIFY */, () => {
                this.log(`${accessory.displayName} identified!`);
            });
            const info = accessory.getService(hap.Service.AccessoryInformation);
            if (info) {
                info.setCharacteristic(hap.Characteristic.Model, device.typeID);
                info.setCharacteristic(hap.Characteristic.SerialNumber, device.metaData.serialNumber);
                info.setCharacteristic(hap.Characteristic.FirmwareRevision, version);
                info.setCharacteristic(hap.Characteristic.FirmwareUpdateStatus, device.isSoftwareUpdateAvailable ? "Update available" : "Up to date");
                info.setCharacteristic(hap.Characteristic.Manufacturer, "Insta GmbH");
                info.setCharacteristic(hap.Characteristic.AppMatchingIdentifier, "de.insta.enet.smarthome");
            }
            const service = accessory
                .getService(hap.Service.Switch);
            service
                .getCharacteristic(hap.Characteristic.On)
                .on("set" /* SET */, async (value, callback) => {
                try {
                    await this.enet.setDevicePrimaryState(accessory.UUID, value);
                    callback();
                }
                catch (error) {
                    this.log.info(error.message);
                }
            });
            service
                .getCharacteristic(hap.Characteristic.On)
                .on("get" /* GET */, (callback) => {
                const device = this.devices[accessory.UUID.toLowerCase()];
                if (device) {
                    callback(null, this.devices[accessory.UUID].state === true);
                }
                else {
                    this.log.error("device", accessory.UUID, "not found");
                    callback(null, false);
                }
            });
            this.accessories.push(accessory);
        })();
    }
}
module.exports = (api) => {
    hap = api.hap;
    Accessory = api.platformAccessory;
    api.registerPlatform(PLATFORM_NAME, ENetPlatform);
};
//# sourceMappingURL=dynamic-platform.js.map