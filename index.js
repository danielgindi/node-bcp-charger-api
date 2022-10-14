import iconv from 'iconv-lite';
import dgram from 'node:dgram';
import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';

/**
 * @typedef {Object} ChargeFaultStatus
 * @property {boolean} overVoltage
 * @property {boolean} underVoltage
 * @property {boolean} overload
 * @property {boolean} highTemperature
 * @property {boolean} groundDetection
 * @property {boolean} leakage
 * @property {boolean} cpSignalAbnormal
 * @property {boolean} emergencyStopButton
 * @property {boolean} ccSignalAbnormal
 * @property {boolean} dlbWiring
 * @property {boolean} dlbOffline
 * @property {boolean} motorLock
 * @property {boolean?} sticking
 * @property {boolean?} contactor
 */

/**
 * @typedef {Object} ChargerControlsState
 * @property {boolean} rfid
 * @property {boolean} appControlCharging
 * @property {boolean} dlb
 * @property {boolean} groundingDetection
 * @property {number} temperatureThreshold
 * @property {number} maxCurrent
 * @property {number} dlbPattern
 * @property {number} dlbMaxCurrent
 * @property {string?} reservation
 * @property {string?} reservationStart
 * @property {string?} reservationEnd
 * @property {number?} maxMonthlyPower
 * @property {boolean?} emergencyStopProtection
 * @property {boolean?} extremeMode
 * @property {boolean?} nightMode
 */

/**
 * @typedef {Object} ChargerRealTimeData
 * @property {number?} electricCurrent - available on 1-phase chargers
 * @property {number?} voltage - available on 1-phase chargers
 * @property {number?} electricCurrentA - available on 3-phase chargers
 * @property {number?} electricCurrentB - available on 3-phase chargers
 * @property {number?} electricCurrentC - available on 3-phase chargers
 * @property {number?} voltageA - available on 3-phase chargers
 * @property {number?} voltageB - available on 3-phase chargers
 * @property {number?} voltageC - available on 3-phase chargers
 * @property {number} power - current power consumption
 * @property {number} totalPower - total power consumption since charger started
 * @property {number} temperature - current charger temperature
 * @property {ChargerState} state
 * @property {boolean} timedChargeEnabled - is the charger in timed charge mode (either pending or charging)
 * @property {string} startChargeTime
 * @property {string} endChargeTime
 * @property {number?} maxCurrent - max current set by the user
 * @property {number?} maxPower - max power set by the user, the charger will stop when `totalPower` reaches this value
 * @property {boolean?} isReservation - has the charger started automatically due to a reservation
 * @property {boolean?} isMaximum - I don't know what this is.
 * @property {boolean?} isExtremeMode - is "extreme mode" enabled for DLB
 */

/**
 * @typedef {Object} ChargerModel
 * @property {ChargerMode} mode
 * @property {string} version
 * @property {string} firmwareVersion
 * @property {string} hardwareVersion
 */

/**
 * @typedef {Object} PowerConsumptionRecords
 * @property {number[]} days
 * @property {number[]} months
 * @property {number[]} years
 */

/**
 * @typedef {Object} PowerConsumptionRecordsOfMonth
 * @property {boolean} isEffective
 * @property {number[]} days
 */

/**
 * @typedef {Object} ParsedMessage
 * @property {string} raw
 * @property {Command} command
 * @property {string} data
 */
/** */

const FRAME_HEADER = '55aa';
const MESSAGE_ID = '0001';

/**
 * @enum {string} Command
 */
const Command = Object.freeze({
    Error: '00',
    Heartbeat: '01',
    PasswordChange: '02',
    GetIpAddress: '03',
    GetChargerModel: '04',
    SetWifiAccessPoint: '05',
    SetChargeState: '06',

    SetTimedChargeState: '69',
    SetRFIDAndApp: '6a',
    SetDLB: '6b',
    SetGroundingDetection: '6c',
    SetMaxCurrent: '6d',
    GetFaultStatus: '6e',
    GetRealTimeData: '70',
    GetControlsState: '71',
    SetBluetoothConnectionMode: '72',
    SwitchIapMode: '73',
    SetMaxPower: '74',
    SetReservation: '75',
    SetTime: '76',
    GetPowerConsumptionRecords: '77',
    SetMaxMonthlyPower: '78',
    SetEmergencyStopProtection: '79',
    GetPowerConsumptionRecordsOfMonth: '7a',
});

/**
 * @enum {number} ChargerMode
 */
const ChargerMode = Object.freeze({
    OnePhase: 0,
    ThreePhase: 1,
});

/**
 * @enum {number} ChargerState
 */
const ChargerState = Object.freeze({
    Abnormal: 0,
    Unplugged: 1,
    Standby: 2,
    NotReady: 5, // plugged, but waiting for ready state from the vehicle
    Charging: 6,
    SelfChecking: 7,
});

class CommandUtil {
    password = '123456';

    constructor() {
    }

    /**
     * @param {string} input
     * @returns {string}
     */
    checksum(input) {
        if (!input)
            return '00';

        input = input.replaceAll(' ', '');
        const length = input.length;

        if ((length % 2) !== 0)
            return '00';

        let chk = 0;

        for (let i = 0; i < length; i += 2) {
            chk += parseInt(input.substring(i, i + 2), 16);
        }

        chk = chk % 0x100;

        return chk.toString(16).padStart(2, '0');
    }

    /**
     * @param {string} input
     * @returns {boolean}
     */
    testChecksum(input) {
        let chk1 = input.substring(input.length - 2);
        let chk2 = this.checksum(input.substring(0, input.length - 2));
        return chk2 === chk1;
    }

    /**
     * @param {string} command
     * @returns {string}
     */
    compileMessage(command) {
        let password = this.password || '123456';

        let encodedPwd = parseInt(password, 10).toString(16).padStart(8, '0');
        let length = Math.trunc(
            (FRAME_HEADER.length + MESSAGE_ID.length + encodedPwd.length + command.length) / 2) + 2;
        let lengthHex = length.toString(16).padStart(2, '0');
        let full = FRAME_HEADER + MESSAGE_ID + lengthHex + encodedPwd + command;
        return full + this.checksum(full);
    }

    /**
     * @param {string} input
     * @returns {ParsedMessage|undefined}
     */
    parseResult(input) {
        if (!input) return;
        if (input.length < 13) return;
        if (!input.startsWith(FRAME_HEADER)) return;
        if (!this.testChecksum(input)) return;

        return {
            raw: input,
            command: input.substring(10, 12),
            data: input.substring(12),
        };
    }

    /**
     * @param {string} input
     * @returns {boolean}
     */
    decodeBoolean(input) {
        return input.substring(0, 2) === '01';
    }

    /**
     * @param {string} hexInput
     * @returns {string}
     */
    decodeString(hexInput) {
        return iconv.decode(Buffer.from(hexInput.replaceAll(' ', ''), 'hex'), 'gbk')
            // eslint-disable-next-line no-control-regex
            .replace(/\x00*$/, '');
    }

    /**
     * @param {string} input
     * @returns {string}
     */
    encodeString(input) {
        return Buffer.from(input, 'utf8').toString('hex').toUpperCase();
    }

    /**
     * @returns {string}
     */
    getCurrentDate() {
        let now = new Date();

        return (now.getFullYear() % 100).toString().padStart(2, '0') +
            (now.getMonth() + 1).toString().padStart(2, '0') +
            now.getDate().toString().padStart(2, '0') +
            now.getHours().toString().padStart(2, '0') +
            now.getMinutes().toString().padStart(2, '0') +
            now.getSeconds().toString().padStart(2, '0');
    }
}

class ChargerController extends EventEmitter {
    /** @type CommandUtil */
    #util;

    /** @type number */
    #resultTimeout = 1000;

    /** @type Socket|null */
    #socket = null;

    /** @type boolean */
    #isConnected = false;

    /** @type Socket|null */
    #connectingSocket = null;

    /** @type string|null */
    #ipAddress = '255.255.255.255';

    /** @type number|null */
    #port = 3333;

    /** @type ChargerModel|null */
    #model = null;

    /** @type ChargeFaultStatus|null */
    #lastFaultStatus = null;

    /** @type ChargerControlsState|null */
    #lastControlsState = null;

    /** @type ChargerRealTimeData|null */
    #lastData = null;

    constructor(password) {
        super();
        this.#util = new CommandUtil();
        this.#util.password = password;
    }

    /**
     * @returns {{port: number, ipAddress: string}}
     */
    get host() {
        return { ipAddress: this.#ipAddress || '255.255.255.255', port: this.#port || 3333 };
    }

    /**
     * Set the host and port of the charger, or broadcast ip and port when ip is not known.
     * @param {string?} ipAddress
     * @param {number?} port
     */
    setHost(ipAddress, port = 3333) {
        if (ipAddress !== this.#ipAddress || port !== this.#port) {
            this.disconnect();
        }

        if (!ipAddress)
            ipAddress = '255.255.255.255';

        this.#ipAddress = ipAddress;
        this.#port = port;
    }

    /**
     * Last model data recorded from calling `sendGetChargerModel()`
     * @returns {ChargerModel|null}
     */
    get modelInfo() {
        return this.#model;
    }

    /**
     * Last controls state recorded from calling `sendGetControlsState()`
     * @returns {ChargerControlsState|null}
     */
    get lastControlsState() {
        return this.#lastControlsState;
    }

    /**
     * Last data recorded from calling `sendGetRealTimeData()`
     * @returns {ChargerRealTimeData|null}
     */
    get lastRealTimeData() {
        return this.#lastData;
    }

    /**
     * Last fault data recorded from calling `sendGetFaultStatus()`
     * @returns {ChargeFaultStatus|null}
     */
    get lastFaultStatus() {
        return this.#lastFaultStatus;
    }

    /**
     * Retrieve last known charger state. `null` if unknown yet.
     * @returns {ChargerState|null}
     */
    get lastKnownState() {
        return this.#lastData?.state ?? null;
    }

    async connect() {
        if (this.#socket) return;

        if (this.#connectingSocket) {
            return new Promise((resolve, reject) => {
                const socket = this.#connectingSocket;

                let onConnect = () => {
                    socket.once('connect', onConnect);
                    socket.once('error', onError);
                    resolve();
                };

                let onError = err => {
                    socket.once('connect', onConnect);
                    socket.once('error', onError);
                    reject(err);
                };

                socket.addListener('connect', onConnect);
                socket.addListener('error', onError);
            });
        }

        const socket = dgram.createSocket('udp4');

        socket.connectAsync = promisify(socket.connect);
        socket.sendAsync = promisify(socket.send);

        this.#connectingSocket = /**@type Socket*/socket;

        socket.addListener('message', (/**Buffer*/msg) => {
            let result = this.#util.parseResult(msg.toString('utf8'));
            if (!result) {
                /**
                 * Malformed message event.
                 *
                 * @event malformed_message
                 * @type {Buffer} message
                 */
                this.emit('malformed_message', msg);
                return;
            }

            if (result.command === Command.Error) {
                let error = this.#util.decodeString(result.data.substring(0, 2));
                /**
                 * Error received from charger. I don't know yet when this happens.
                 *
                 * @event charger_error
                 * @type {string} code
                 */
                this.emit('charger_error', error);
            }

            /**
             * Each message sent back from the charger.
             *
             * @event message
             * @type {ParsedMessage} message
             */
            this.emit('message', result);
        });

        try {
            await new Promise((resolve, reject) => {
                socket.on('error', reject);
                socket.on('listening', () => {
                    if (this.#ipAddress.endsWith('.255'))
                        socket.setBroadcast(true);

                    resolve();
                });
                socket.bind(this.#port);
            });

            this.#isConnected = true;
            this.#socket = /**@type Socket*/socket;
        } catch (err) {
            this.#isConnected = false;
            socket.close();
            throw err;
        } finally {
            this.#connectingSocket = null;
        }
    }

    disconnect() {
        if (this.#socket) {
            this.#socket.close();
            this.#socket = null;
        }

        this.#isConnected = false;
    }

    /**
     *
     * @param {string} command
     * @param {boolean|string?} waitForResult
     * @param {function(message: ParsedMessage): boolean?} resultTester
     * @returns {Promise<ParsedMessage|undefined>}
     */
    async sendCommand(command, waitForResult, resultTester) {
        const message = this.#util.compileMessage(command);
        const buffer = Buffer.from(message, 'utf8');

        await this.connect();

        const socket = this.#socket;

        if (waitForResult) {
            const resultCode = typeof waitForResult === 'string' ? waitForResult : command.substring(0, 2);

            return new Promise((resolve, reject) => {
                let onMessage = /**Buffer*/msg => {
                    let result = this.#util.parseResult(msg.toString('utf8'));
                    if (!result)
                        return;

                    if (result.command !== resultCode ||
                        (resultTester && !resultTester(result)))
                        return;

                    socket.removeListener('message', onMessage);
                    resolve(result);
                };

                socket.on('message', onMessage);

                if (this.#resultTimeout > 0) {
                    setTimeout(() => {
                        socket.off('message', onMessage);
                        reject(new Error('result timed out'));
                    }, this.#resultTimeout);
                }

                socket.send(buffer, this.#port, this.#ipAddress, err => {
                    if (err)
                        return reject(err);
                });
            });
        } else {
            await socket.sendAsync(buffer, this.#port, this.#ipAddress);
        }
    }

    async sendHeartbeat() {
        await this.sendCommand(Command.Heartbeat, true);

        /**
         * A heartbeat response sent back from the charger.
         *
         * @event heartbeat
         */
        this.emit('heartbeat');
    }

    /**
     * @param {string} password
     * @returns {Promise<boolean>}
     */
    async sendSetPassword(password) {
        let result = await this.sendCommand(
            Command.PasswordChange + parseInt(password, 10).toString(16).padStart(8, '0'),
            true);
        this.#util.password = password;

        /**
         * The charger password was successfully changed.
         *
         * @event password
         * @type {string} password
         */
        this.emit('password', password);

        return this.#util.decodeBoolean(result.data);
    }

    /**
     * Broadcast a request to resolve the charger's IP address and port, based on it's identification code.
     * @param {string} code - the charger's code, visible on a sticker on the charger, or in the z-box app.
     * @returns {Promise<{port: number, ip: string}>}
     */
    async sendGetIpAddress(code) {
        let result = await this.sendCommand(
            Command.GetIpAddress + parseInt(code, 10).toString(16).padStart(8, '0'),
            true,
            result => parseInt(result.data.substring(0, 8), 16) === parseInt(code, 10));

        let ipAddress = parseInt(result.data.substring(8, 10), 16) + '.' +
            parseInt(result.data.substring(10, 12), 16) + '.' +
            parseInt(result.data.substring(12, 14), 16) + '.' +
            parseInt(result.data.substring(14, 16), 16);
        let port = parseInt(result.data.substring(16, 20), 16);

        this.setHost(ipAddress, port);

        /**
         * An ip address and port was received from the charger.
         *
         * @event ip
         * @type {Object} event
         * @property {string} ip
         * @property {number} port
         */
        this.emit('ip', { ip: ipAddress, port: port });

        return { ip: ipAddress, port: port };
    }

    /**
     * @returns {Promise<ChargerModel>}
     */
    async sendGetChargerModel() {
        let result = await this.sendCommand(Command.GetChargerModel, true);

        /** @type ChargerModel */
        let model = {
            mode: /**@type ChargerMode*/parseInt(result.data.substring(0, 4), 16),
            version: this.#util.decodeString(result.data.substring(4, 44)),
            firmwareVersion: parseInt(result.data.substring(44, 46), 16).toString() + '.' +
                parseInt(result.data.substring(46, 48), 16).toString().padStart(2, '0'),
            hardwareVersion: parseInt(result.data.substring(48, 50), 16).toString(),
        };

        this.#model = model;

        /**
         * Charger model info has been retrieved.
         *
         * @event charger_model
         * @type {ChargerModel}
         */
        this.emit('charger_model', model);

        return model;
    }

    /**
     *
     * @param {string} ssid
     * @param {string} password
     * @returns {Promise<boolean>}
     */
    async sendSetWifiAccessPoint(ssid, password) {
        let result = await this.sendCommand(Command.SetWifiAccessPoint +
            ssid.length.toString(16).padStart(2, '0') +
            password.length.toString(16).padStart(2, '0') +
            this.#util.encodeString(ssid) +
            this.#util.encodeString(password),
            true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     *
     * @param {boolean} charging
     * @returns {Promise<boolean>}
     */
    async sendSetChargeState(charging) {
        let result = await this.sendCommand(Command.SetChargeState +
            (charging ? '01' : '00'),
            true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     *
     * @param {string} fromTime 'HH:mm' / 'HH:mm:ss'
     * @param {string} toTime 'HH:mm' / 'HH:mm:ss'
     * @returns {Promise<boolean>}
     */
    async sendSetTimedChargeState(fromTime, toTime) {
        let now = new Date();
        let nowInSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

        let fromInSeconds = (parseInt(fromTime.substring(0, 2), 10) || 0) * 3600 +
            (parseInt(fromTime.substring(3, 5), 10) || 0) * 60 +
            (parseInt(fromTime.substring(6, 8), 10) || 0) * 60 - nowInSeconds;
        let toInSeconds = (parseInt(toTime.substring(0, 2), 10) || 0) * 3600 +
            (parseInt(toTime.substring(3, 5), 10) || 0) * 60 +
            (parseInt(toTime.substring(6, 8), 10) || 0) * 60 - nowInSeconds;

        if (fromInSeconds < 0)
            fromInSeconds += 86400;
        while (toInSeconds < 0 || toInSeconds < fromInSeconds)
            toInSeconds += 86400;

        let timingString = fromInSeconds.toString(16).padStart(8, '0');
        timingString += toInSeconds.toString(16).padStart(8, '0');

        const nowHours = now.getHours();
        const nowMinutes = now.getMinutes();
        const nowSeconds = now.getSeconds();

        timingString += (parseInt(fromTime.substring(0, 2), 10) || 0).toString(16).padStart(2, '0') +
            (parseInt(fromTime.substring(3, 5), 10) || 0).toString(16).padStart(2, '0') +
            (parseInt(fromTime.substring(6, 8), 10) || 0).toString(16).padStart(2, '0');

        timingString += (parseInt(toTime.substring(0, 2), 10) || 0).toString(16).padStart(2, '0') +
            (parseInt(toTime.substring(3, 5), 10) || 0).toString(16).padStart(2, '0') +
            (parseInt(toTime.substring(6, 8), 10) || 0).toString(16).padStart(2, '0');

        timingString += nowHours.toString(16).padStart(2, '0') +
            nowMinutes.toString(16).padStart(2, '0') +
            nowSeconds.toString(16).padStart(2, '0');

        let result = await this.sendCommand(Command.SetTimedChargeState + timingString,
            true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     *
     * @param {boolean} rfidEnabled
     * @param {boolean} appEnabled
     * @returns {Promise<boolean>}
     */
    async sendSetRFIDAndApp(rfidEnabled, appEnabled) {
        let result = await this.sendCommand(Command.SetRFIDAndApp +
            (rfidEnabled ? '01' : '00') + (appEnabled ? '01' : '00'),
            true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     *
     * @param {boolean} enabled
     * @param {boolean} extremeMode
     * @param {number} maxCurrent
     * @param {boolean} nightMode
     * @returns {Promise<boolean>}
     */
    async sendSetDLB(enabled, extremeMode, maxCurrent, nightMode) {
        let result = await this.sendCommand(Command.SetDLB +
            (enabled ? '01' : '00') +
            (extremeMode ? '01' : '00') +
            Math.min(Math.trunc(maxCurrent), 0xff).toString(16).padStart(2, '0') +
            (nightMode ? '01' : '00'),
            true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     *
     * @param {boolean} enabled
     * @returns {Promise<boolean>}
     */
    async sendSetGroundingDetection(enabled) {
        let result = await this.sendCommand(Command.SetGroundingDetection +
            (enabled ? '01' : '00'),
            true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     *
     * @param {number} maxCurrent
     * @returns {Promise<boolean>}
     */
    async sendSetMaxCurrent(maxCurrent) {
        let result = await this.sendCommand(Command.SetMaxCurrent +
            Math.min(Math.trunc(maxCurrent), 0xff).toString(16).padStart(4, '0'),
            true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     *
     * @returns {Promise<ChargeFaultStatus>}
     */
    async sendGetFaultStatus() {
        let result = (await this.sendCommand(Command.GetFaultStatus, true))?.data;

        const isV108 = result.length >= 26;

        /** @type ChargeFaultStatus */
        let status = {
            overVoltage: parseInt(result.substring(0, 2), 16) !== 0,
            underVoltage: parseInt(result.substring(2, 4), 16) !== 0,
            overload: parseInt(result.substring(4, 6), 16) !== 0,
            highTemperature: parseInt(result.substring(6, 8), 16) !== 0,
            groundDetection: parseInt(result.substring(8, 10), 16) !== 0,
            leakage: parseInt(result.substring(10, 12), 16) !== 0,
            cpSignalAbnormal: parseInt(result.substring(12, 14), 16) !== 0,
            emergencyStopButton: parseInt(result.substring(14, 16), 16) !== 0,
            ccSignalAbnormal: parseInt(result.substring(16, 18), 16) !== 0,
            dlbWiring: parseInt(result.substring(18, 20), 16) !== 0,
            dlbOffline: parseInt(result.substring(20, 22), 16) !== 0,
            motorLock: parseInt(result.substring(22, 24), 16) !== 0,
        };

        if (isV108) {
            status.sticking = parseInt(result.substring(24, 26), 16) !== 0;
            status.contactor = parseInt(result.substring(26, 28), 16) !== 0;
        }

        this.#lastFaultStatus = status;

        /**
         * A fault status has been returned from the router.
         *
         * @event fault_status
         * @type {ChargeFaultStatus}
         */
        this.emit('fault_status', status);

        return status;
    }

    /**
     *
     * @returns {Promise<ChargerRealTimeData>}
     */
    async sendGetRealTimeData() {
        let result = (await this.sendCommand(Command.GetRealTimeData, true))?.data;

        let ptr = 0;

        let resultLengthByte = result.length;

        /** @type ChargerRealTimeData */
        let data = {};

        let isV106 = false;
        let isV108 = false;
        let isV110 = false;

        if (this.#model.mode === ChargerMode.OnePhase) {
            data.electricCurrent = parseInt(result.substring(ptr, ptr + 4), 16);
            data.voltage = parseInt(result.substring(ptr + 4, ptr + 8), 16);
            ptr += 8;

            isV106 = resultLengthByte >= 36;
            isV108 = resultLengthByte >= 42;
            isV110 = resultLengthByte >= 44;
        } else if (this.#model.mode === ChargerMode.ThreePhase) {
            data.electricCurrentA = parseInt(result.substring(ptr, ptr + 2), 16);
            data.electricCurrentB = parseInt(result.substring(ptr + 2, ptr + 4), 16);
            data.electricCurrentC = parseInt(result.substring(ptr + 4, ptr + 6), 16);
            ptr += 6;

            data.voltageA = parseInt(result.substring(ptr, ptr + 4), 16);
            data.voltageB = parseInt(result.substring(ptr + 4, ptr + 8), 16);
            data.voltageC = parseInt(result.substring(ptr + 8, ptr + 12), 16);
            ptr += 12;

            isV106 = resultLengthByte >= 46;
            isV108 = resultLengthByte >= 52;
            isV110 = resultLengthByte >= 54;
        }

        data.power = parseInt(result.substring(ptr, ptr + 4), 16) / 10;
        data.totalPower = parseInt(result.substring(ptr + 4, ptr + 8), 16) / 10;
        data.temperature = parseInt(result.substring(ptr + 8, ptr + 10), 16) - 100;
        data.state = /**@type ChargerState*/parseInt(result.substring(ptr + 10, ptr + 12), 16);
        if (data.state === 4) // 4 and 1 are the same
            data.state = ChargerState.Unplugged;
        else if (data.state === 3) // 3 and 2 are the same
            data.state = ChargerState.Standby;
        ptr += 12;

        data.timedChargeEnabled = result.substring(ptr, ptr + 2) !== '00';
        ptr += 2;

        data.startChargeTime = parseInt(result.substring(ptr, ptr + 2), 16).toString().padStart(2, '0') + ':' +
            parseInt(result.substring(ptr + 2, ptr + 4), 16).toString().padStart(2, '0') + ':' +
            parseInt(result.substring(ptr + 4, ptr + 6), 16).toString().padStart(2, '0');
        ptr += 6;

        data.endChargeTime = parseInt(result.substring(ptr, ptr + 2), 16).toString().padStart(2, '0') + ':' +
            parseInt(result.substring(ptr + 2, ptr + 4), 16).toString().padStart(2, '0') + ':' +
            parseInt(result.substring(ptr + 4, ptr + 6), 16).toString().padStart(2, '0');
        ptr += 6;

        if (isV106) {
            data.maxCurrent = parseInt(result.substring(46, 48), 16);
            data.maxPower = parseInt(result.substring(48, 50), 16);
            data.isReservation = parseInt(result.substring(50, 52), 16) === 1;
            ptr += 6;
        }

        if (isV108) {
            data.isMaximum = parseInt(result.substring(ptr, ptr + 2), 16) === 1;
            ptr += 2;
        }

        if (isV110) {
            data.isExtremeMode = parseInt(result.substring(ptr, ptr + 2), 16) === 1;
        }

        this.#lastData = data;

        /**
         * A charger data has been returned from the router.
         *
         * @event realtime_data
         * @type {ChargerRealTimeData}
         */
        this.emit('realtime_data', data);

        return data;
    }

    /**
     *
     * @returns {Promise<ChargerControlsState>}
     */
    async sendGetControlsState() {
        let result = (await this.sendCommand(Command.GetControlsState, true))?.data;

        /** @type ChargerControlsState */
        let control = {
            rfid: parseInt(result.substring(0, 2), 16) === 1,
            appControlCharging: parseInt(result.substring(2, 4), 16) === 1,
            dlb: parseInt(result.substring(4, 6), 16) !== 0, // possible values: 00 disabled, 01 enabled, 02 ?
            groundingDetection: parseInt(result.substring(6, 8), 16) === 1,
            temperatureThreshold: parseInt(result.substring(8, 10), 16),
            maxCurrent: parseInt(result.substring(10, 14), 16),
            dlbPattern: parseInt(result.substring(14, 16), 16),
            dlbMaxCurrent: parseInt(result.substring(16, 18), 16),
        };

        const isV106 = result.length >= 20;
        let i = 18;
        if (isV106) {
            control.reservation = parseInt(result.substring(18, 20), 16).toString(2).padStart(7, '0');
            control.reservationStart = (parseInt(result.substring(20, 22), 16) || 0).toString().padStart(2, '0') +
                (parseInt(result.substring(22, 24), 16) || 0).toString().padStart(2, '0');
            control.reservationEnd = (parseInt(result.substring(24, 26), 16) || 0).toString().padStart(2, '0') +
                (parseInt(result.substring(26, 28), 16) || 0).toString().padStart(2, '0');
            i = 28;
        }

        const isV108 = result.length >= 30;
        if (isV108) {
            control.maxMonthlyPower = parseInt(result.substring(i, i + 4), 16);
            i += 4;
            control.emergencyStopProtection = (parseInt(result.substring(i, i + 2), 16) || 0) === 1;
            i += 2;
        }

        const isV110 = result.length >= 36;
        if (isV110) {
            control.extremeMode = parseInt(result.substring(i, i + 2), 16) === 1;
            control.nightMode = parseInt(result.substring(i + 2, i + 4), 16) === 1;
        }

        this.#lastControlsState = control;

        /**
         * A controls state data has been returned from the router.
         *
         * @event controls_state
         * @type {ChargerControlsState}
         */
        this.emit('controls_state', control);

        return control;
    }

    /**
     *
     * @param {boolean} enabled
     * @returns {Promise<boolean>}
     */
    async sendSetBluetoothConnectionMode(enabled) {
        let result = await this.sendCommand(Command.SetBluetoothConnectionMode +
            (enabled ? '01' : '00'),
            true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     *
     * @param {boolean} enabled
     * @returns {Promise<boolean>}
     */
    async sendSwitchIapMode(enabled) {
        let result = await this.sendCommand(Command.SwitchIapMode +
            (enabled ? '01' : '00'),
            true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     * Set the maximum power to charge the car with. When it reaches this number, the charger will stop.
     * @param {number} maxPower
     * @returns {Promise<boolean>}
     */
    async sendSetMaxPower(maxPower) {
        let result = await this.sendCommand(Command.SetMaxPower +
            Math.min(Math.trunc(maxPower), 0xff).toString(16).padStart(2, '0'),
            true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     *
     * @param {string} fromTime HH:mm
     * @param {string} toTime HH:mm
     * @param {string?} daysOfWeek sunday-saturday "1010101"
     * @returns {Promise<boolean>}
     */
    async sendSetReservation(fromTime, toTime, daysOfWeek) {
        let rsr = this.#util.getCurrentDate();

        if (!daysOfWeek) {
            rsr += '00';
        } else {
            let week = '';
            for (let i = 0; i < 7; i++) {
                week += daysOfWeek[i] === '1' ? '1' : '0';
            }

            rsr += parseInt(week, 2).toString(16).padStart(2, '0');
        }

        rsr += fromTime
            ? (parseInt(fromTime.substring(0, 2), 10) || 0).toString(16).padStart(2, '0') +
            (parseInt(fromTime.substring(3, 5), 10) || 0).toString(16).padStart(2, '0')
            : '0000';
        rsr += toTime
            ? (parseInt(toTime.substring(0, 2), 10) || 0).toString(16).padStart(2, '0') +
            (parseInt(toTime.substring(3, 5), 10) || 0).toString(16).padStart(2, '0')
            : '0000';

        let result = await this.sendCommand(Command.SetReservation + rsr, true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     *
     * @returns {Promise<boolean>}
     */
    async sendSyncTime() {
        let result = await this.sendCommand(Command.SetTime + this.#util.getCurrentDate(), true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     *
     * @returns {Promise<PowerConsumptionRecords>}
     */
    async sendGetPowerConsumptionRecords() /**PowerConsumptionRecords*/ {
        let result = (await this.sendCommand(Command.GetPowerConsumptionRecords, true))?.data;

        let days = [];
        let months = [];
        let years = [];

        let ptr = 0;
        for (let i = 0; i < 20; i++) {
            days.push((parseInt(result.substring(ptr, ptr + 4), 16) || 0) / 10);
            ptr += 4;
        }

        for (let i = 0; i < 12; i++) {
            months.push((parseInt(result.substring(ptr, ptr + 4), 16) || 0) / 10);
            ptr += 4;
        }

        const isV111 = result.length >= 130;
        if (isV111) {
            for (let i = 0; i < 10; i++) {
                years.push((parseInt(result.substring(ptr, ptr + 4), 16) || 0));
                ptr += 4;
            }
        }

        /** @type PowerConsumptionRecords */
        return {
            days: days,
            months: months,
            years: years,
        };
    }

    /**
     *
     * @param {number} year
     * @param {number} month
     * @returns {Promise<PowerConsumptionRecordsOfMonth>}
     */
    async sendGetPowerConsumptionRecordsOfMonth(year, month) /**PowerConsumptionRecordsOfMonth*/ {
        let date = (year < 2000 ? 0 : year - 2000).toString(16).padStart(2, '0') +
            (month - 1).toString(16).padStart(2, '0');

        let result = (await this.sendCommand(Command.GetPowerConsumptionRecordsOfMonth + date, true))?.data;

        const monthLastDay = new Date(year, month, 0).getDate();

        const isEffective = result.substring(0, 2) === '01';
        let days = [];

        let ptr = 2;
        for (let i = 0; i < monthLastDay; i++) {
            days.push((parseInt(result.substring(ptr, ptr + 4), 16) || 0) / 10);
            ptr += 4;
        }

        /** @type PowerConsumptionRecordsOfMonth */
        return {
            isEffective: isEffective,
            days: days,
        };
    }

    /**
     *
     * @param {number} maxCurrent
     * @returns {Promise<boolean>}
     */
    async sendSetMaxMonthlyPower(maxCurrent) {
        let result = await this.sendCommand(Command.SetMaxMonthlyPower +
            Math.min(Math.trunc(maxCurrent), 0xffff).toString(16).padStart(4, '0'),
            true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     *
     * @param {boolean} enabled
     * @returns {Promise<boolean>}
     */
    async sendSetEmergencyStopProtection(enabled) {
        let result = await this.sendCommand(Command.SetEmergencyStopProtection +
            (enabled ? '01' : '00'),
            true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     * @returns {boolean}
     */
    get canStopCharging() {
        return this.#lastData?.state === ChargerState.NotReady || this.#lastData?.state === ChargerState.Charging;
    }

    /**
     * @returns {boolean}
     */
    get canStartCharging() {
        return this.#lastData?.state === ChargerState.Standby;
    }
}

export { ChargerController, Command, ChargerMode, ChargerState };

