import iconv from 'iconv-lite';
import dgram from 'node:dgram';
import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';

/**
 * @typedef {Object} ChargeRealTimeStatus
 * @property {number} overVoltageFault
 * @property {number} underVoltageFault
 * @property {number} overloadFault
 * @property {number} highTemperatureFault
 * @property {number} groundDetectionFault
 * @property {number} leakageFault
 * @property {number} cpSignalAbnormalFault
 * @property {number} emergencyStopButtonFault
 * @property {number} ccSignalAbnormalFault
 * @property {number} dlbWiringFault
 * @property {number} dlbOfflineFault
 * @property {number} motorLockFault
 * @property {number?} stickingFault
 * @property {number?} contactorFault
 */

/**
 * @typedef {Object} ChargerControls
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
 * @property {number?} maxMonthlyCurrent
 * @property {boolean?} emergencyStopProtection
 * @property {boolean?} extremeMode
 * @property {boolean?} nightMode
 */

/**
 * @typedef {Object} ChargerRealTimeData
 * @property {number?} electricCurrent
 * @property {number?} voltage
 * @property {number?} electricCurrentA
 * @property {number?} electricCurrentB
 * @property {number?} electricCurrentC
 * @property {number?} voltageA
 * @property {number?} voltageB
 * @property {number?} voltageC
 * @property {number} power
 * @property {number} degrees
 * @property {number} temperature
 * @property {number} state
 * @property {boolean} timedChargeState
 * @property {string} startChargeTime
 * @property {string} endChargeTime
 * @property {number?} maxCurrent
 * @property {number?} stopDegrees
 * @property {boolean?} isReservation
 * @property {boolean?} isMaximum
 * @property {boolean?} isExtremeMode
 */

/**
 * @typedef {Object} ChargerModel
 * @property {number} mode
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
 * @property {string} command
 * @property {string} data
 */
/** */

const FRAME_HEADER = '55aa';
const MESSAGE_ID = '0001';

const Commands = Object.freeze({
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
    GetRealTimeStatus: '6e',
    GetRealTimeData: '70',
    GetControlsState: '71',
    SetBluetoothConnectionMode: '72',
    SwitchIapMode: '73',
    SetMaxDegrees: '74',
    SetReservation: '75',
    SetTime: '76',
    GetPowerConsumptionRecords: '77',
    SetMaxMonthlyCurrent: '78',
    SetEmergencyStopProtection: '79',
    GetPowerConsumptionRecordsOfMonth: '7a',
});

const DeviceModes = Object.freeze({
    OnePhase: 0,
    ThreePhase: 1,
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

class DeviceController extends EventEmitter {
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

    /** @type ChargeRealTimeStatus|null */
    #lastStatus = null;

    /** @type ChargerControls|null */
    #lastControl = null;

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
    getHost() {
        return { ipAddress: this.#ipAddress || '255.255.255.255', port: this.#port || 3333 };
    }

    /**
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
     * @returns {ChargerModel|null}
     */
    getModelData() {
        return this.#model;
    }

    /**
     * @returns {ChargerControls|null}
     */
    getLastControlsState() {
        return this.#lastControl;
    }

    /**
     * @returns {ChargerRealTimeData|null}
     */
    getLastData() {
        return this.#lastData;
    }

    /**
     * @returns {ChargeRealTimeStatus|null}
     */
    getLastStatus() {
        return this.#lastStatus;
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
                this.emit('malformed_message', msg);
                return;
            }

            if (result.command === Commands.Error) {
                let error = this.#util.decodeString(result.data.substring(0, 2));
                this.emit('charger_error', error);
            }

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
        await this.sendCommand(Commands.Heartbeat, true);
        this.emit('heartbeat');
    }

    /**
     * @param {string} password
     * @returns {Promise<boolean>}
     */
    async sendSetPassword(password) {
        let result = await this.sendCommand(
            Commands.PasswordChange + parseInt(password, 10).toString(16).padStart(8, '0'),
            true);
        this.#util.password = password;
        this.emit('password', password);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     * @param {string} code
     * @returns {Promise<string>}
     */
    async sendGetIpAddress(code) {
        let result = await this.sendCommand(
            Commands.GetIpAddress + parseInt(code, 10).toString(16).padStart(8, '0'),
            true,
            result => parseInt(result.data.substring(0, 8), 16) === parseInt(code, 10));

        let ipAddress = parseInt(result.data.substring(8, 10), 16) + '.' +
            parseInt(result.data.substring(10, 12), 16) + '.' +
            parseInt(result.data.substring(12, 14), 16) + '.' +
            parseInt(result.data.substring(14, 16), 16);
        let port = parseInt(result.data.substring(16, 20), 16);

        this.setHost(ipAddress, port);

        this.emit('ip', ipAddress);

        return ipAddress;
    }

    /**
     * @returns {Promise<ChargerModel>}
     */
    async sendGetChargerModel() {
        let result = await this.sendCommand(Commands.GetChargerModel, true);

        /** @type ChargerModel */
        let model = {
            mode: parseInt(result.data.substring(0, 4), 16),
            version: this.#util.decodeString(result.data.substring(4, 44)),
            firmwareVersion: parseInt(result.data.substring(44, 46), 16).toString() + '.' +
                parseInt(result.data.substring(46, 48), 16).toString().padStart(2, '0'),
            hardwareVersion: parseInt(result.data.substring(48, 50), 16).toString(),
        };

        this.#model = model;

        return model;
    }

    /**
     *
     * @param {string} ssid
     * @param {string} password
     * @returns {Promise<boolean>}
     */
    async sendSetWifiAccessPoint(ssid, password) {
        let result = await this.sendCommand(Commands.SetWifiAccessPoint +
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
        let result = await this.sendCommand(Commands.SetChargeState +
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

        let result = await this.sendCommand(Commands.SetTimedChargeState + timingString,
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
        let result = await this.sendCommand(Commands.SetRFIDAndApp +
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
        let result = await this.sendCommand(Commands.SetDLB +
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
        let result = await this.sendCommand(Commands.SetGroundingDetection +
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
        let result = await this.sendCommand(Commands.SetMaxCurrent +
            Math.min(Math.trunc(maxCurrent), 0xff).toString(16).padStart(4, '0'),
            true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     *
     * @returns {Promise<ChargeRealTimeStatus>}
     */
    async sendGetRealTimeStatus() {
        let result = (await this.sendCommand(Commands.GetRealTimeStatus, true))?.data;

        const isV108 = result.length >= 26;

        /** @type ChargeRealTimeStatus */
        let status = {
            overVoltageFault: parseInt(result.substring(0, 2), 16),
            underVoltageFault: parseInt(result.substring(2, 4), 16),
            overloadFault: parseInt(result.substring(4, 6), 16),
            highTemperatureFault: parseInt(result.substring(6, 8), 16),
            groundDetectionFault: parseInt(result.substring(8, 10), 16),
            leakageFault: parseInt(result.substring(10, 12), 16),
            cpSignalAbnormalFault: parseInt(result.substring(12, 14), 16),
            emergencyStopButtonFault: parseInt(result.substring(14, 16), 16),
            ccSignalAbnormalFault: parseInt(result.substring(16, 18), 16),
            dlbWiringFault: parseInt(result.substring(18, 20), 16),
            dlbOfflineFault: parseInt(result.substring(20, 22), 16),
            motorLockFault: parseInt(result.substring(22, 24), 16),
        };

        if (isV108) {
            status.stickingFault = parseInt(result.substring(24, 26), 16);
            status.contactorFault = parseInt(result.substring(26, 28), 16);
        }

        this.#lastStatus = status;

        this.emit('status', status);

        return status;
    }

    /**
     *
     * @returns {Promise<ChargerRealTimeData>}
     */
    async sendGetRealTimeData() {
        let result = (await this.sendCommand(Commands.GetRealTimeData, true))?.data;

        let ptr = 0;

        let resultLengthByte = result.length;

        /** @type ChargerRealTimeData */
        let data = {};

        let isV106 = false;
        let isV108 = false;
        let isV110 = false;

        if (this.#model.mode === DeviceModes.OnePhase) {
            data.electricCurrent = parseInt(result.substring(ptr, ptr + 4), 16);
            data.voltage = parseInt(result.substring(ptr + 4, ptr + 8), 16);
            ptr += 8;

            isV106 = resultLengthByte >= 36;
            isV108 = resultLengthByte >= 42;
            isV110 = resultLengthByte >= 44;
        } else if (this.#model.mode === DeviceModes.ThreePhase) {
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
        data.degrees = parseInt(result.substring(ptr + 4, ptr + 8), 16) / 10;
        data.temperature = parseInt(result.substring(ptr + 8, ptr + 10), 16) - 100;
        data.state = parseInt(result.substring(ptr + 10, ptr + 12), 16);
        ptr += 12;

        data.timedChargeState = parseInt(result.substring(ptr, ptr + 2), 16) === 1;
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
            data.stopDegrees = parseInt(result.substring(48, 50), 16);
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

        this.emit('data', data);

        return data;
    }

    /**
     *
     * @returns {Promise<ChargerControls>}
     */
    async sendGetControlsState() {
        let result = (await this.sendCommand(Commands.GetControlsState, true))?.data;

        /** @type ChargerControls */
        let control = {
            rfid: parseInt(result.substring(0, 2), 16) === 1,
            appControlCharging: parseInt(result.substring(2, 4), 16) === 1,
            dlb: parseInt(result.substring(4, 6), 16) === 1,
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
            control.maxMonthlyCurrent = parseInt(result.substring(i, i + 4), 16);
            i += 4;
            control.emergencyStopProtection = (parseInt(result.substring(i, i + 2), 16) || 0) === 1;
            i += 2;
        }

        const isV110 = result.length >= 36;
        if (isV110) {
            control.extremeMode = parseInt(result.substring(i, i + 2), 16) === 1;
            control.nightMode = parseInt(result.substring(i + 2, i + 4), 16) === 1;
        }

        this.#lastControl = control;

        this.emit('control', control);

        return control;
    }

    /**
     *
     * @param {boolean} enabled
     * @returns {Promise<boolean>}
     */
    async sendSetBluetoothConnectionMode(enabled) {
        let result = await this.sendCommand(Commands.SetBluetoothConnectionMode +
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
        let result = await this.sendCommand(Commands.SwitchIapMode +
            (enabled ? '01' : '00'),
            true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     *
     * @param {number} maxDegrees
     * @returns {Promise<boolean>}
     */
    async sendSetMaxDegrees(maxDegrees) {
        let result = await this.sendCommand(Commands.SetMaxDegrees +
            Math.min(Math.trunc(maxDegrees), 0xff).toString(16).padStart(2, '0'),
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

        let result = await this.sendCommand(Commands.SetReservation + rsr, true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     *
     * @returns {Promise<boolean>}
     */
    async sendSetTime() {
        let result = await this.sendCommand(Commands.SetTime + this.#util.getCurrentDate(), true);
        return this.#util.decodeBoolean(result.data);
    }

    /**
     *
     * @returns {Promise<PowerConsumptionRecords>}
     */
    async sendGetPowerConsumptionRecords() /**PowerConsumptionRecords*/ {
        let result = (await this.sendCommand(Commands.GetPowerConsumptionRecords, true))?.data;

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
     * @param {number} maxCurrent
     * @returns {Promise<boolean>}
     */
    async sendSetMaxMonthlyCurrent(maxCurrent) {
        let result = await this.sendCommand(Commands.SetMaxMonthlyCurrent +
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
        let result = await this.sendCommand(Commands.SetEmergencyStopProtection +
            (enabled ? '01' : '00'),
            true);
        return this.#util.decodeBoolean(result.data);
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

        let result = (await this.sendCommand(Commands.GetPowerConsumptionRecordsOfMonth + date, true))?.data;

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
     * @returns {string}
     */
    getStatusText() {
        switch (this.#lastData?.state) {
            case 0:
                return 'Abnormal';
            case 1:
            case 4:
                return 'Unplugged';
            case 2:
            case 3:
                return 'Standby';
            case 5:
                return 'Not ready';
            case 6:
                return 'Charging';
            case 7:
                return 'Self-checking';
        }

        return '';
    }

    /**
     * @returns {string}
     */
    getStatusDesc() {
        switch (this.#lastData?.state) {
            case 1:
            case 4:
                return 'Waiting for plug';
            case 2:
            case 3:
                return 'You can start charging';
            case 5:
                return 'Waiting for ready state from vehicle';
        }

        return '';
    }

    /**
     * @returns {boolean}
     */
    canStopCharging() {
        return this.#lastData?.state === 5 || this.#lastData?.state === 6;
    }

    /**
     * @returns {boolean}
     */
    canStartCharging() {
        return this.#lastData?.state === 2 || this.#lastData?.state === 3;
    }
}

export { DeviceController, Commands, DeviceModes };

