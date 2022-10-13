# @danielgindi/bcp-charger-api

[![npm Version](https://badge.fury.io/js/@danielgindi%2Fbcp-charger-api.png)](https://npmjs.org/package/@danielgindi/bcp-charger-api)

A node.js api for controlling the BCP EV chargers (Z-Box compatible chargers).  

Most features in the Z-Box app are available, except firmware updates.

## Installation:

```
npm install --save @danielgindi/bcp-charger-api
```

## Usage example:

```javascript

import { ChargerController } from '@danielgindi/bcp-charger-api';

let charger = new ChargerController('123456');

// Take the code from the QR on the charger or the Z-Box app, and let's resolve the IP address for the charger.
await charger.sendGetIpAddress('012345678');

// Let's fetch basic info about the charger so that state commands could work.
await charger.sendGetChargerModel();

if (await charger.sendSetChargeState(true)) {
  console.log('Charging started!');
} else {
  console.log('Charging failed!');
}

```

### class ChargerController

All methods/properties/events are documented in the code.

#### Methods:
* `setHost(ip: string, port: number = 3333)`
* `async sendGetIpAddress(chargerCode: string): Promise<{port: number, ip: string}>`
* `async sendHeartbeat(): Promise<void>`
* `async sendGetChargerModel(): Promise<ChargerModel>`
* `async sendSetPassword(password: string): Promise<boolean>`
* `async sendSetWifiAccessPoint(ssid: string, password: string): Promise<boolean>`
* `async sendSetTimedChargeState(fromTime: string, toTime: string): Promise<boolean>`
* `async sendSetRFIDAndApp(rfidEnabled: boolean, appEnabled: boolean): Promise<boolean>`
* `async sendSetDLB(enabled: boolean, extremeMode: boolean, maxCurrent: number, nightMode: boolean): Promise<boolean>`
* `async sendSetGroundingDetection(enabled: boolean): Promise<boolean>`
* `async sendSetMaxCurrent(maxCurrent: number): Promise<boolean>`
* `async sendGetFaultStatus(): Promise<ChargeFaultStatus>`
* `async sendGetRealTimeData(): Promise<ChargerRealTimeData>`
* `async sendGetControlsState(): Promise<ChargerControlsState>`
* `async sendSetBluetoothConnectionMode(enabled: boolean): Promise<boolean>`
* `async sendSwitchIapMode(enabled: boolean): Promise<boolean>`
* `async sendSetMaxPower(maxPower: number): Promise<boolean>`
* `async sendSetReservation(fromTime: string, toTime: string, daysOfWeek: string): Promise<boolean>`
* `async sendSyncTime(): Promise<boolean>`
* `async sendGetPowerConsumptionRecords(): Promise<PowerConsumptionRecords>`
* `async sendGetPowerConsumptionRecordsOfMonth(year: number, month: number): Promise<PowerConsumptionRecordsOfMonth>`
* `async sendSetMaxMonthlyPower(maxCurrent: number): Promise<boolean>`
* `async sendSetEmergencyStopProtection(enabled: boolean): Promise<boolean>`

#### Properties:
* `get host: {port: number, ipAddress: string}`
* `get modelInfo: ChargerModel|null`
* `get lastControlsState: ChargerControlsState|null`
* `get lastRealTimeData: ChargerRealTimeData|null`
* `get lastFaultStatus: ChargeFaultStatus|null`
* `get lastKnownState: ChargerState|null`
* `get canStopCharging: boolean`
* `get canStartCharging: boolean`

#### Events:
* `'malformed_message' (message: Buffer)`
* `'charger_error' (code: string)`
* `'message' (message: ParsedMessage)`
* `'heartbeat' ()`
* `'password' (password: string)`
* `'ip' (event: { ip: string, port: number })`
* `'fault_status' (status: ChargeFaultStatus)`
* `'realtime_data' (data: ChargerRealTimeData)`
* `'controls_state' (data: ChargerControlsState)`


## Contributing

If you have anything to contribute, or functionality that you lack - you are more than welcome to participate in this!
If anyone wishes to contribute unit tests - that also would be great :-)

## Me
* Hi! I am Daniel Cohen Gindi. Or in short- Daniel.
* danielgindi@gmail.com is my email address.
* That's all you need to know.

## Help

If you want to buy me a beer, you are very welcome to
[![Donate](https://www.paypalobjects.com/en_US/i/btn/btn_donate_LG.gif)](https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=G6CELS3E997ZE)
 Thanks :-)

## License

All the code here is under MIT license. Which means you could do virtually anything with the code.
I will appreciate it very much if you keep an attribution where appropriate.

    The MIT License (MIT)

    Copyright (c) 2013 Daniel Cohen Gindi (danielgindi@gmail.com)

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.
