import { ENet } from "enet-api";
import { ENetClient } from "enet-api";
import fs from "fs";
import {
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  DynamicPlatformPlugin,
  HAP,
  Logging,
  PlatformAccessory,
  PlatformAccessoryEvent,
  PlatformConfig
} from "homebridge";
const { version } = require("../package.json");

const PLUGIN_NAME = "homebridge-enet";
const PLATFORM_NAME = "eNetPlatform";

let hap: HAP;
let Accessory: typeof PlatformAccessory;

export = (api: API) => {
  hap = api.hap;
  Accessory = api.platformAccessory;

  api.registerPlatform(PLATFORM_NAME, ENetPlatform);
};

class ENetPlatform implements DynamicPlatformPlugin {

  private readonly log: Logging;
  private readonly api: API;
  private readonly config: PlatformConfig;
  private enet: ENet;
  private enetClient: ENetClient;

  private readonly accessories: PlatformAccessory[] = [];
  private devices: { [id: string]: any } = {};

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.api = api;
    this.config = config;

    this.log.info(`eNet start initializing!`);

    const path = `${this.api.user.storagePath()}/.enet`;
    if (!fs.existsSync(path)) {
      fs.writeFileSync(path, JSON.stringify({ token: null }), { encoding: "utf8" });
    }
    var token = null;
    try {
      token = JSON.parse(fs.readFileSync(path, { encoding: "utf8" })).token;
    } catch (error) { }

    if (token === null) {
      this.log.info("Authentication needed!");
      this.enet = new ENet(config.host);
      this.enet.authenticate(this.config.username, this.config.password)
        .then((token: string) => {
          fs.writeFileSync(path, JSON.stringify({ token }), { encoding: "utf8" });
          this.setupNow();
        })
        .catch((error: Error) => {
          this.log.error(error.message);
        })
    } else {
      this.log.info("No need to reauth, we have token!");
      this.enet = new ENet(config.host, token);
      this.config.token = token;
      this.setupNow();
    }

    // Handle polling
    const interval: number = typeof config.interval === "number" ? config.interval : 10;
    if (interval >= 3) {
      setInterval(() => {
        this.poll();
      }, interval * 1000)
    }

  }

  setupNow() {
    return new Promise<void>(async (resolve, reject) => {
      try {
        // const devices = await this.enet.getDevices();
        console.log('setupNow()....')
        // console.log(this.config)
        const client = new ENetClient(this.config.host, this.config.token);
        const devices = await client.getDevicesWithParameterFilter();

        this.log.info(devices);

        for (let device of devices) {
          const uuid = device.uid.toLowerCase();
          delete device.uid;
          this.devices[uuid] = device;
          this.devices[uuid].state = null;
          if (!this.accessories.find(accessory => accessory.UUID === uuid)) {
            const accessory = new this.api.platformAccessory(device.installationArea, uuid);
            accessory.addService(hap.Service.Switch, device.installationArea);
            // accessory.displayName = device.installationArea+'_'+device.typeID+' '+device.metaData.serialNumber;
            this.accessories.push(accessory);
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          }
        }

        resolve();
      } catch (error: any) {
        reject(error.message);
      }

    });
  }


  poll() {
    for (const deviceUID in this.devices) {
      this.enet.getDevicePrimaryState(deviceUID).then((res: any) => {
        this.devices[deviceUID].state = res;
      });
    }
  }


  configureAccessory(accessory: PlatformAccessory): void {

    (async () => {

      this.log.info(`Configuring '${accessory.UUID}'`);

      const device = await this.enet.getDeviceInfo(accessory.UUID);

      accessory.on(PlatformAccessoryEvent.IDENTIFY, () => {
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
        .getService(hap.Service.Switch)!;

      service
        .getCharacteristic(hap.Characteristic.On)
        .on(CharacteristicEventTypes.SET, async (value: CharacteristicValue, callback: CharacteristicSetCallback) => {

          try {
            await this.enet.setDevicePrimaryState(accessory.UUID, value);
            callback();
          } catch (error: any) {
            this.log.info(error.message);
          }

        });

      service
        .getCharacteristic(hap.Characteristic.On)
        .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
          const device = this.devices[accessory.UUID.toLowerCase()];
          if (device) {
            callback(null, this.devices[accessory.UUID].state === true);
          } else {
            this.log.error("device", accessory.UUID, "not found");
            callback(null, false);
          }
        });


      this.accessories.push(accessory);

    })();

  }

}