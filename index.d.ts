export interface ChargeFaultStatus {
    overVoltage: boolean;
    underVoltage: boolean;
    overload: boolean;
    highTemperature: boolean;
    groundDetection: boolean;
    leakage: boolean;
    cpSignalAbnormal: boolean;
    emergencyStopButton: boolean;
    ccSignalAbnormal: boolean;
    dlbWiring: boolean;
    dlbOffline: boolean;
    motorLock: boolean;
    sticking?: boolean;
    contactor?: boolean;
}

export interface ChargerControlsState {
    rfid: boolean;
    appControlCharging: boolean;
    dlb: boolean;
    groundingDetection: boolean;
    temperatureThreshold: number;
    maxCurrent: number;
    dlbPattern: number;
    dlbMaxCurrent: number;
    reservation?: string;
    reservationStart?: string;
    reservationEnd?: string;
    maxMonthlyPower?: number;
    emergencyStopProtection?: boolean;
    extremeMode?: boolean;
    nightMode?: boolean;
}

/**
 * available on 1-phase chargers
 */
export interface SinglePhaseChargerRealTimeData {
    electricCurrent?: number;
    voltage?: number;
}

/**
 * available on 3-phase chargers
 */
export interface ThreePhaseChargerRealTimeData {
    electricCurrentA?: number;
    electricCurrentB?: number;
    electricCurrentC?: number;
    voltageA?: number;
    voltageB?: number;
    voltageC?: number;
}

export interface ChargerRealTimeData extends SinglePhaseChargerRealTimeData, ThreePhaseChargerRealTimeData {
    /**
     * current power consumption
     */
    power: number;
    /**
     * total power consumption since charger started
     */
    totalPower: number;
    /**
     * current charger temperature
     */
    temperature: number;
    state: ChargerState;
    /**
     * is the charger in timed charge mode (either pending or charging)
     */
    timedChargeEnabled: boolean;
    startChargeTime: string;
    endChargeTime: string;
    /**
     * max current set by the user
     */
    maxCurrent?: number;
    /**
     * max power set by the user, the charger will stop when `totalPower` reaches this value
     */
    maxPower?: number;
    /**
     * has the charger started automatically due to a reservation
     */
    isReservation?: boolean;
    /**
     * I don't know what this is.
     */
    isMaximum?: boolean;
    /**
     * is "extreme mode" enabled for DLB
     */
    isExtremeMode?: boolean;
}

export interface ChargerModel {
    mode: ChargerMode;
    version: string;
    firmwareVersion: string;
    hardwareVersion: string;
}

export interface PowerConsumptionRecords {
    days: number[];
    months: number[];
    years: number[];
}

export interface PowerConsumptionRecordsOfMonth {
    isEffective: boolean;
    days: number[];
}

export interface ParsedMessage {
    raw: string;
    command: Command;
    data: string;
}

export class ChargerController extends EventEmitter {
    constructor(password: any);

    /**
     * @returns {{port: number, ipAddress: string}}
     */
    get host(): {
        port: number;
        ipAddress: string;
    };

    /**
     * Set the host and port of the charger, or broadcast ip and port when ip is not known.
     */
    setHost(ipAddress?: string, port?: number): void;

    /**
     * Last model data recorded from calling `sendGetChargerModel()`
     */
    get modelInfo(): ChargerModel|null;

    /**
     * Last controls state recorded from calling `sendGetControlsState()`
     */
    get lastControlsState(): ChargerControlsState|null;

    /**
     * Last data recorded from calling `sendGetRealTimeData()`
     */
    get lastRealTimeData(): ChargerRealTimeData|null;

    /**
     * Last fault data recorded from calling `sendGetFaultStatus()`
     * @returns {ChargeFaultStatus|null}
     */
    get lastFaultStatus(): ChargeFaultStatus|null;

    /**
     * Retrieve last known charger state. `null` if unknown yet.
     * @returns {ChargerState|null}
     */
    get lastKnownState(): number|null;
    connect(): Promise<any>;
    disconnect(): void;

    /**
     *
     * @param command
     * @param waitForResult
     * @param resultTester
     */
    sendCommand(command: string, waitForResult?: boolean | string, resultTester?: (message: ParsedMessage) => boolean): Promise<ParsedMessage | undefined>;

    sendHeartbeat(): Promise<void>;

    sendSetPassword(password: string): Promise<boolean>;

    /**
     * Broadcast a request to resolve the charger's IP address and port, based on it's identification code.
     * @param code the charger's code, visible on a sticker on the charger, or in the z-box app.
     */
    sendGetIpAddress(code: string): Promise<{
        port: number;
        ip: string;
    }>;

    sendGetChargerModel(): Promise<ChargerModel>;

    sendSetWifiAccessPoint(ssid: string, password: string): Promise<boolean>;

    sendSetChargeState(charging: boolean): Promise<boolean>;

    /**
     *
     * @param fromTime 'HH:mm' / 'HH:mm:ss'
     * @param toTime 'HH:mm' / 'HH:mm:ss'
     */
    sendSetTimedChargeState(fromTime: string, toTime: string): Promise<boolean>;

    sendSetRFIDAndApp(rfidEnabled: boolean, appEnabled: boolean): Promise<boolean>;

    sendSetDLB(enabled: boolean, extremeMode: boolean, maxCurrent: number, nightMode: boolean): Promise<boolean>;

    sendSetGroundingDetection(enabled: boolean): Promise<boolean>;

    sendSetMaxCurrent(maxCurrent: number): Promise<boolean>;

    sendGetFaultStatus(): Promise<ChargeFaultStatus>;

    sendGetRealTimeData(): Promise<ChargerRealTimeData>;

    sendGetControlsState(): Promise<ChargerControlsState>;

    sendSetBluetoothConnectionMode(enabled: boolean): Promise<boolean>;

    sendSwitchIapMode(enabled: boolean): Promise<boolean>;

    /**
     * Set the maximum power to charge the car with. When it reaches this number, the charger will stop.
     */
    sendSetMaxPower(maxPower: number): Promise<boolean>;

    /**
     *
     * @param fromTime HH:mm
     * @param toTime HH:mm
     * @param daysOfWeek sunday-saturday "1010101"
     */
    sendSetReservation(fromTime: string, toTime: string, daysOfWeek?: string): Promise<boolean>;

    sendSyncTime(): Promise<boolean>;

    sendGetPowerConsumptionRecords(): Promise<PowerConsumptionRecords>;

    sendGetPowerConsumptionRecordsOfMonth(year: number, month: number): Promise<PowerConsumptionRecordsOfMonth>;

    sendSetMaxMonthlyPower(maxCurrent: number): Promise<boolean>;

    sendSetEmergencyStopProtection(enabled: boolean): Promise<boolean>;

    get canStopCharging(): boolean;

    get canStartCharging(): boolean;

    get resultTimeout(): number;
    set resultTimeout(timeout: number);
}

export enum Command {
    Error = "00",
    Heartbeat = "01",
    PasswordChange = "02",
    GetIpAddress = "03",
    GetChargerModel = "04",
    SetWifiAccessPoint = "05",
    SetChargeState = "06",
    SetTimedChargeState = "69",
    SetRFIDAndApp = "6a",
    SetDLB = "6b",
    SetGroundingDetection = "6c",
    SetMaxCurrent = "6d",
    GetFaultStatus = "6e",
    GetRealTimeData = "70",
    GetControlsState = "71",
    SetBluetoothConnectionMode = "72",
    SwitchIapMode = "73",
    SetMaxPower = "74",
    SetReservation = "75",
    SetTime = "76",
    GetPowerConsumptionRecords = "77",
    SetMaxMonthlyPower = "78",
    SetEmergencyStopProtection = "79",
    GetPowerConsumptionRecordsOfMonth = "7a",
}

export enum ChargerMode {
    OnePhase = 0,
    ThreePhase = 1,
}

export enum ChargerState {
    Abnormal = 0,
    Unplugged = 1,
    Standby = 2,
    NotReady = 5,
    Charging = 6,
    SelfChecking = 7,
}

import { EventEmitter } from 'events';
