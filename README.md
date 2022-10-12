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

import { DeviceController } from '@danielgindi/bcp-charger-api';

let charger = new DeviceController('123456');

// Take the code from the QR on the charger or the Z-Box app, and let's resolve the IP address for the charger.
await charger.sendGetIpAddress('012345678');

// Let's fetch basic info about the charger so that state commands could work.
await charger.sendGetChargerModel();

if (await charger.sendSetChargeState(true)) {
  console.log('Charging started!');
} else {
  console.log('Charging failed!');
}

// Other commands, documented in the code:
// await charger.sendHeartbeat();
// await charger.sendSetPassword(password);
// await charger.sendSetWifiAccessPoint(ssid, password);
// await charger.sendSetTimedChargeState('22:00', '05:00');
// await charger.sendSetRFIDAndApp(true, true);
// await charger.sendSetDLB(true, false, 16, true);
// await charger.sendSetGroundingDetection(true);
// await charger.sendSetMaxCurrent(16);
// await charger.sendGetRealTimeStatus();
// await charger.sendGetRealTimeData();
// await charger.sendGetControlsState();
// await charger.sendSetBluetoothConnectionMode(true);
// await charger.sendSwitchIapMode(true);
// await charger.sendSetMaxDegrees(85);
// await charger.sendSetReservation('21:00', '05:00', '1011011');
// await charger.sendSetTime();
// await charger.sendGetPowerConsumptionRecords();
// await charger.sendGetPowerConsumptionRecordsOfMonth();
// await charger.sendSetMaxMonthlyCurrent(490);
// await charger.sendSetEmergencyStopProtection(true);

// Other functions, documented in the code:
// await charger.getHost();
// await charger.setHost('255.255.255.255', 3333);
// await charger.getModelData();
// await charger.getLastControlsState();
// await charger.getLastData();
// await charger.getLastStatus();
// await charger.getStatusText();
// await charger.getStatusDesc();
// await charger.canStopCharging();
// await charger.canStartCharging();

```

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
