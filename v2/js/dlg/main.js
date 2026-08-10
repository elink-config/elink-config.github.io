// VN connect-button state (thay the helper i18n cua tool goc)
function setConnectButtonState(state) {
    var el = document.getElementById('connectbutton');
    if (!el) return;
    var map = { scan: 'Kết nối', scanning: 'Đang quét...', connecting: 'Đang kết nối...', disconnect: 'Ngắt kết nối' };
    el.setAttribute('data-connect-state', state);
    if (map[state]) el.textContent = map[state];
}
function formatDeg(v) { return v + '°'; }
// nut "Gui lenh" cua hub: gui hex qua RxTx
window.sendcmd = async function () {
    var inp = document.getElementById('cmdTXT');
    var v = inp ? (inp.value || '').trim() : '';
    if (!v) { addLog('Nhập lệnh hex trước.'); return; }
    await triggerRxTxCmd(v);
};

// Extracted from elink-config.github.io/index.html (DLG-CLOCK tool)
// and adapted for the combined da14585-webtool hub.

        let bleDevice;
        let gattServer;
        let epdService;
        let rxtxService;
        let epdCharacteristic;
        let rxtxCharacteristic;
        let reconnectTrys = 0;
        const my_step = 480;
        function delay(delayInMs) {
            return new Promise(resolve => {
                setTimeout(() => {
                    resolve(2);
                }, delayInMs);
            });
        }
        function resetVariables() {
            gattServer = null;
            epdService = null;
            epdCharacteristic = null;
            rxtxCharacteristic = null;
            rxtxService = null;
            document.getElementById("log").value = '';
        }
        async function handleError(error) {
            console.log(error);
            resetVariables();
            if (bleDevice == null)
                return;
            if (reconnectTrys <= 5) {
                reconnectTrys++;
                await connect();
            } else {
                addLog('Không kết nối được, dừng thử lại');
                reconnectTrys = 0;
            }
        }
        async function sendCommand(cmd) {
            if (epdCharacteristic) {
                await epdCharacteristic.writeValueWithResponse(cmd)
            } else {
                addLog('Chưa kết nối Bluetooth!')
            }
        }
        async function clearScreen(cmd) {
            addLog('Làm mới màn hình')
            await triggerEpdCmd(`00${cmd}`);
            await triggerEpdCmd('01')
        }
        async function rxTxSendCommand(cmd) {
            if (rxtxCharacteristic) {
                await rxtxCharacteristic.writeValueWithResponse(cmd);
            } else {
                addLog('Chưa kết nối Bluetooth!')
            }
        }
        async function SendCommand(cmd) {
            let code;
            for (let i; i < cmd.length; i += 2) {
                code = '' + cmd[i] + cmd[i + 1];
                triggerRxTxCmd(code);
                await delay(1000);
            }
        }
        async function rxTxSendCommand2(cmd) {
            if (rxtxCharacteristic) {
                await rxtxCharacteristic.writeValueWith(cmd);
            } else {
                addLog('Chưa kết nối Bluetooth!')
            }
        }
       
        async function sendBufferData(value, type) {
            addLog(`Bắt đầu gửi ảnh (${type}), kích thước ${value.length} byte`);
            let code = 'ff';
            if (type === 'bwr') {
                code = '00';
            }
            let cod = '03';
            if (value.length == 7000 || value.length == 18000) { cod = '04'; }
            const step = my_step;
            let partIndex = 0;
            for (let i = 0; i < value.length; i += step) {
                addLog(`Gửi khối ${partIndex + 1}, ${step / 2 + 4} byte, vị trí ${i / 2}`);
                await sendCommand(hexToBytes(cod + code + intToHex(i / 2, 2) + value.substring(i, i + step)));
                partIndex += 1;
            }
        }
        function updateCanvasSize() {
            const sizeSelect = document.getElementById('screen-size');
            const canvas = document.getElementById('canvas');
            const ctx = canvas.getContext("2d");
            // option values are "<name>_<width>_<height>"
            const parts = sizeSelect.value.split('_');
            const width = parseInt(parts[1], 10);
            const height = parseInt(parts[2], 10);
            canvas.width = width;
            canvas.height = height;
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, width, height);
            update_image();
            addLog(`Đã đặt kích thước canvas: ${width}x${height}`);
        }
        async function upload_image() {
            const canvas = document.getElementById('canvas');
            const startTime = new Date().getTime();
            if(canvas.width==296){
                
                 await sendBufferData(bytesToHex(canvas2bytes_bw(canvas)), 'bw')
                 await sendBufferData(bytesToHex(canvas2bytes_bw(canvas, 'bwr')), 'bwr')
            }else if(canvas.width==250 ||canvas.width==212){
                 await sendBufferData(bytesToHex(canvas2bytes_bw(canvas)), 'bw')
            }else{
                await sendBufferData(bytesToHex(canvas2bytes(canvas)), 'bw')
                await sendBufferData(bytesToHex(canvas2bytes(canvas, 'bwr')), 'bwr')
            }
            
            await delay(300);
            if (canvas.width == 280 || canvas.height == 180) { await sendCommand(hexToBytes("AA")) }
            else { await sendCommand(hexToBytes("01")) }
            addLog(`Tải lên xong, thời gian: ${(new Date().getTime() - startTime) / 1000}s`);
        }
        function formatSetTimeButtonText(year, month, day, localeTimeString, week, hourOffset) {
            const stLabel = 'Đặt giờ';
            return `${stLabel}: ${year}-${month}-${day} ${localeTimeString}`;
        }
        async function setTime() {
            let { unixNow, localeTimeString, year, month, day, week, hourOffset } = getUnixTime();
            unixNow += 10;
            const timeSetter = document.getElementById('time-setter');
            if (timeSetter) {
                timeSetter.innerText = formatSetTimeButtonText(year, month, day, localeTimeString, week, hourOffset);
            }
            addLog("Đã đặt giờ: " + localeTimeString + " (chênh lệch múi giờ: " + hourOffset + ") : dd" + intToHex(unixNow, 4));
            await rxTxSendCommand(hexToBytes('dd' +
                [intToHex(unixNow, 4), intToHex(year, 2), intToHex(month, 1), intToHex(day, 1), intToHex(week, 1)].join('')));
            await rxTxSendCommand(hexToBytes('e2'))
        }
        async function setri(cmd) {
            addLog(`Lệnh: ${cmd}`)
            await rxTxSendCommand(hexToBytes(cmd));
            await delay(300);
            addLog(`Lệnh: e2`)
            await rxTxSendCommand(hexToBytes('e2'))
        }
        async function triggerRxTxCmd(cmd) {
            addLog(`Gửi lệnh: ${cmd}`)
            await rxTxSendCommand(hexToBytes(cmd));
        }
        async function triggerRxTxCmd2(cmd) {
            addLog(`Sending command: ${cmd}`)
            await rxTxSendCommand2(hexToBytes(cmd));
        }
        async function triggerEpdCmd(cmd) {
            addLog(`Sending command: ${cmd}`)
            await sendCommand(hexToBytes(cmd));
        }
        async function triggerEpdRed_lut(cmd) {
            addLog(`Hiệu chỉnh màu đỏ: ${cmd}`)
            cmd = 'E6' + cmd;
            await rxTxSendCommand(hexToBytes(cmd));
        }
        async function triggerEpdJH(cmd) {
            addLog(`Lệnh kích hoạt: ${cmd}`)
            cmd = 'EF' + cmd;
            await rxTxSendCommand(hexToBytes(cmd));
            await delay(500);
            await rxTxSendCommand(hexToBytes('e2'))
        }
        async function triggerEpdCHEPAI(cmd) {
            addLog(`Số: ${cmd}`)
            let cp = '';
            for (let index = 0; index < cmd.length; index++) {
                cp = cp + cmd[index] + cmd[index];
            }
            cp = 'EF' + cp;
            await rxTxSendCommand(hexToBytes(cp));
            await delay(500);
            await rxTxSendCommand(hexToBytes('e2'))
        }
        async function triggerRxTxCmd_LED(cmd) {
            let color = document.getElementById('led_color').value;
            let D_S_hour = document.getElementById('D_S_hour').value;
            let D_S_min = document.getElementById('D_S_min').value;
            D_S_hour = D_S_hour > 9 ? D_S_hour : '0' + D_S_hour;
            D_S_min = D_S_min > 9 ? D_S_min : '0' + D_S_min;
            let note = color != '07' ? '01' : '00';
            cmd = cmd + note + color + D_S_hour + D_S_min;
            addLog(`LED: ${cmd}`)
            await rxTxSendCommand(hexToBytes(cmd));
        }
        async function triggerRxTxCmd_XM(cmd) {
          
            let D_S_hour = document.getElementById('D_S_hour').value;
            let D_S_min = document.getElementById('D_S_min').value;
            D_S_hour = D_S_hour > 9 ? D_S_hour : '0' + D_S_hour;
            D_S_min = D_S_min > 9 ? D_S_min : '0' + D_S_min;
           
            cmd = cmd  + D_S_hour + D_S_min;
            addLog(`Đặt khoảng không làm mới: ${cmd}`)
            await rxTxSendCommand(hexToBytes(cmd));
        }
        function disconnect() {
            resetVariables();
            addLog('Đã ngắt kết nối.');
            setConnectButtonState('scan');
        }
        async function preConnect() {
            if (gattServer != null && gattServer.connected) {
                if (bleDevice != null && bleDevice.gatt.connected)
                    bleDevice.gatt.disconnect();
            } else {
                reconnectTrys = 0;
                try {
                    setConnectButtonState('scanning');
                    bleDevice = await navigator.bluetooth.requestDevice({
                        filters: [{ namePrefix: 'DLG-CLOCK-' }],
                        optionalServices: ['0000221f-0000-1000-8000-00805f9b34fb', '00001f10-0000-1000-8000-00805f9b34fb', '13187b10-eba9-a3ba-044e-83d3217d9a38']
                    });
                    bleDevice.addEventListener('gattserverdisconnected', disconnect);
                } catch (e) {
                    setConnectButtonState('scan');
                    addLog('Quét bị hủy hoặc lỗi: ' + e.message);
                    return;
                }
                try {
                    await connect();
                } catch (e) {
                    await handleError(e);
                }
            }
        }
        async function connectRXTX() {
            rxtxService = await gattServer.getPrimaryService('00001f10-0000-1000-8000-00805f9b34fb');
            addLog('> Tìm thấy dịch vụ RxTx');
            rxtxCharacteristic = await rxtxService.getCharacteristic('00001f1f-0000-1000-8000-00805f9b34fb');
            addLog('> Đã kết nối đặc tính RxTx');
        }
        async function reConnect() {
            reconnectTrys = 0;
            if (bleDevice != null && bleDevice.gatt.connected)
                bleDevice.gatt.disconnect();
            resetVariables();
            addLog('Kết nối lại...');
            await delay(300);
            try {
                await connect();
            } catch (e) {
                await handleError(e);
            }
        }
        async function connect() {
            if (epdCharacteristic == null) {
                setConnectButtonState('connecting');
                addLog('Đang kết nối: ' + bleDevice.name);
                gattServer = await bleDevice.gatt.connect();
                addLog('> Đã kết nối GATT server');
                await connectRXTX();
                try {
                    epdService = await gattServer.getPrimaryService('13187b10-eba9-a3ba-044e-83d3217d9a38');
                    addLog('> Tìm thấy dịch vụ EPD');
                    epdCharacteristic = await epdService.getCharacteristic('4b646063-6264-f3a7-8941-e65356ea82fe');
                    addLog('> Đã kết nối đặc tính EPD');
                    await epdCharacteristic.startNotifications();
                    epdCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
                        console.log('epd ret', bytesToHex(event.target.value.buffer));
                        const count = parseInt('0x' + bytesToHex(event.target.value.buffer));
                        addLog(`> [Từ màn hình]: đã nhận ${count} byte`);
                    });
                } catch (e) {
                    addLog('> Không thấy dịch vụ EPD, dùng RxTx thay thế');
                    epdCharacteristic = rxtxCharacteristic;
                }
                setConnectButtonState('disconnect');
            }
        }
        function setStatus(statusText) {
            document.getElementById("status").innerHTML = statusText;
        }
        // addLog: provided by the hub (js/connector.js)
        function getUnixTime() {
            const hourOffset = document.getElementById('hour-offset').value;
            let unixNow = Math.round(Date.now() / 1000) + (60 * 60 * (hourOffset)) - new Date().getTimezoneOffset() * 60;
            const date = new Date((unixNow + new Date().getTimezoneOffset() * 60) * 1000);
            const localeTimeString = date.toLocaleTimeString();
            
            // Firmware tÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â»ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â± ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¹Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â»ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ng trÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â»ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â« 1 tiÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂºÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¿ng (giÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂºÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â£ ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¹Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â»ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¹nh web UTC+8, mÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂºÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ch UTC+7). CÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â»ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ng bÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¹ 3600 giÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢y ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¹Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â»ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â‚¬Å¾Ã‚Â¢ mÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂºÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ch chÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚ÂºÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡y ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¾ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¹Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Âºng giÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â»ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â.
            unixNow += 3600;
            
            return {
                unixNow,
                localeTimeString,
                year: date.getFullYear(),
                month: date.getMonth() + 1,
                day: date.getDate(),
                week: date.getDay() || 7,
                hourOffset
            }
        }
        let currentRotation = 0;
        let currentImage = null;
        let degrees1 = 0;
        function rotateImage(degrees) {
          if(degrees){
            currentRotation = (currentRotation + degrees) % 360;}
            else {currentRotation =0;}
            degrees1 = currentRotation;
            if (currentImage) {
                drawImageWithRotation(currentImage);
                update_image();
            }
        }
        let currentScaleX = 1.0;  
        let currentScaleY = 1.0;  
        function stretchToCanvas() {
            if (!currentImage) return;
            const canvas = document.getElementById("canvas");
            if (degrees1 == 0 || degrees1 == 180) {
                currentScaleX = canvas.width / currentImage.width;
                currentScaleY= canvas.height / currentImage.height;
            } else {
                currentScaleX =  canvas.height/ currentImage.width;
                currentScaleY = canvas.width / currentImage.height;
            }
          
            updateScaleDisplay();
            drawImageWithRotation(currentImage);
            update_image();
        }
        function fitToCanvas() {
            if (!currentImage) return;
            const canvas = document.getElementById("canvas");
            let canvasW, canvasH, imgW, imgH;
            if (degrees1 == 0 || degrees1 == 180) {
                canvasW = canvas.width;
                canvasH = canvas.height;
                imgW = currentImage.width;
                imgH = currentImage.height;
            } else {
                canvasW = canvas.height;
                canvasH = canvas.width;
                imgW = currentImage.width;
                imgH = currentImage.height;
            }
            const ratio = Math.min(canvasW / imgW, canvasH / imgH);
            currentScaleX = ratio;
            currentScaleY = ratio;
            currentScale = 1.0;
            updateScaleDisplay();
            drawImageWithRotation(currentImage);
            update_image();
        }
        function updateScale(value) {
            currentScale = value / 100;
            updateScaleDisplay();
            if (currentImage) {
                drawImageWithRotation(currentImage);
                update_image();
            }
        }
        let currentScale = 1.0;  
        function updateScaleDisplay() {
            document.getElementById('scaleValue').textContent = `${Math.round(currentScale * 100)}%`;
            document.getElementById('scaleSlider').value = currentScale * 100;
        }
       let imageSource = null;
        let imageSource1 = null;
        async function update_image1() {
            imageSource1=null;
            update_image();   
        }
        async function update_image(imageSource) {
            const image_file = document.getElementById('image_file');
            if(imageSource)imageSource1 =imageSource;
             if (imageSource1){
                const canvas = document.getElementById("canvas");
                const ctx = canvas.getContext("2d");
                const image = new Image();
                image.src = imageSource1;
                image.onload = function (event) {
                    URL.revokeObjectURL(this.src);
                    currentImage = image;
                    drawImageWithRotation(image);
                    applyImageAdjustments(canvas);
                    convert_dithering();
                }
                    return;
             } 
            if (image_file.files.length > 0) {
                const file = image_file.files[0];
                const canvas = document.getElementById("canvas");
                const ctx = canvas.getContext("2d");
                const image = new Image();
                image.src = URL.createObjectURL(file);
                image.onload = function (event) {
                    URL.revokeObjectURL(this.src);
                    currentImage = image;
                    drawImageWithRotation(image);
                    applyImageAdjustments(canvas);
                    convert_dithering();
                }
            }
        }
        function updateRotation(value) {
            currentRotation = parseInt(value);
            document.getElementById('rotationValue').textContent = typeof formatDeg === 'function' ? formatDeg(value) : (value + ' deg');
            if (currentImage) {
                drawImageWithRotation(currentImage);
                update_image();
            }
        }
        function drawImageWithRotation(image) {
            const canvas = document.getElementById("canvas");
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(currentRotation * Math.PI / 180);
            ctx.scale(currentScale, currentScale);
            ctx.scale(currentScaleX, currentScaleY);
            const width = image.width;
            const height = image.height;
            ctx.drawImage(
                image,
                -width / 2, -height / 2,
                width, height
            );
            ctx.restore();
        }
        function get_position(canvas, x, y) {
            let rect = canvas.getBoundingClientRect()
            return {
                x: x - rect.left * (canvas.width / rect.width),
                y: y - rect.top * (canvas.height / rect.height)
            }
        }
        function clear_canvas() {
            if (confirm('Xóa canvas?')) {
                const canvas = document.getElementById('canvas');
                const ctx = canvas.getContext("2d");
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
        }
        function convert_dithering() {
            const canvas = document.getElementById('canvas');
            const ctx = canvas.getContext("2d");
            const mode = document.getElementById('dithering').value;
            const threshold = parseInt(document.getElementById('threshold').value);
            dithering(ctx, canvas.width, canvas.height, threshold, mode);
        }
        document.body.onload = () => {
            setInterval(() => {
                const { localeTimeString, year, month, day, week, hourOffset } = getUnixTime();
                const timeSetter = document.getElementById('time-setter');
                if (timeSetter) {
                    timeSetter.innerText = formatSetTimeButtonText(year, month, day, localeTimeString, week, hourOffset);
                }
            }, 1000);
            const canvas = document.getElementById('canvas');
            const ctx = canvas.getContext("2d");
            updateCanvasSize();
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            document.getElementById('dithering').value = 'bwr_floydsteinberg';
            var rb = document.getElementById('reconnectbutton'); if (rb) rb.disabled = false;
            var sb = document.getElementById('sendcmdbutton'); if (sb) sb.disabled = false;
        }

// ---- Countdown module ----
        (function () {
            const textInput = document.getElementById('textInput');
            const fontFamily = document.getElementById('fontFamily');
            const datePicker = document.getElementById('datePicker');
            const invertColors = document.getElementById('invertColors');
            const showGrid = document.getElementById('showGrid');
            const generateBtn = document.getElementById('generateBtn');
            const previewCanvas = document.getElementById('previewCanvas');
            const codeOutput = document.getElementById('codeOutput');
            const copyBtn = document.getElementById('copyBtn');
            const gridInfoText = document.getElementById('gridInfoText');
            const fontSizeSlider = document.getElementById('fontSizeSlider');
            const fontSizeValue = document.getElementById('fontSizeValue');
            const gridSizeSelect = document.getElementById('gridSizeSelect');
            const currentGridSize = document.getElementById('currentGridSize');
            const sizeHint = document.getElementById('sizeHint');
            const ctx = previewCanvas.getContext('2d');
            const previewScale = 8;
            let fontSizeRatio = 0.85;

            syncModeUi();
            updateGridSize();
            drawPreview();

            generateBtn.addEventListener('click', function () {
                drawPreview();
                generateCode();
            });

            copyBtn.addEventListener('click', function () {
                sendcode();
            });

            fontSizeSlider.addEventListener('input', function () {
                const value = this.value;
                fontSizeValue.textContent = `${value}%`;
                fontSizeRatio = value / 100;
                drawPreview();
            });

            gridSizeSelect.addEventListener('change', function () {
                syncModeUi();
                updateGridSize();
                drawPreview();
            });

            function getCurrentGridSize() {
                return parseInt(gridSizeSelect.value, 10);
            }

            function getCountdownStyle() {
                return 0;
            }

            function getMaxLabelLength() {
                return 8;
            }

            function getFallbackLabel() {
                return 'COUNT';
            }

            function sanitizeInputValue() {
                const maxLen = getMaxLabelLength();
                const sanitized = (textInput.value || '').replace(/[^\x20-\x7E]/g, ' ').slice(0, maxLen);
                if (textInput.value !== sanitized) {
                    textInput.value = sanitized;
                }
                return sanitized;
            }

            function getCountdownLabel() {
                const sanitized = sanitizeInputValue().trimEnd();
                return sanitized || '';
            }

            function syncModeUi() {
                const maxLen = getMaxLabelLength();
                gridSizeSelect.value = '16';
                if (textInput.value === 'Days until' || textInput.value === 'DATE') {
                    textInput.value = getFallbackLabel();
                }
                textInput.maxLength = maxLen;
                sanitizeInputValue();
                textInput.placeholder = 'Nhập 1–8 ký tự';
                if (sizeHint) {
                    sizeHint.textContent = 'Đếm ngược đồng hồ hỗ trợ tối đa 8 ký tự ASCII.';
                }
            }

            function updateGridSize() {
                currentGridSize.textContent = '';
            }

            function drawPreview() {
                const label = getCountdownLabel() || getFallbackLabel();
                const charCount = label.length;
                const font = fontFamily.value;
                const invert = invertColors.checked;
                const grid = showGrid.checked;
                const gridSize = getCurrentGridSize();

                previewCanvas.width = charCount * gridSize * previewScale;
                previewCanvas.height = gridSize * previewScale;
                ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
                ctx.fillStyle = invert ? '#000000' : '#ffffff';
                ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

                const charWidth = gridSize * previewScale;
                ctx.font = `bold ${gridSize * fontSizeRatio * previewScale}px ${font}`;
                ctx.textBaseline = 'middle';
                ctx.fillStyle = invert ? '#ffffff' : '#000000';

                for (let i = 0; i < charCount; i++) {
                    const currentChar = label[i];
                    const charX = i * charWidth + charWidth / 2;
                    ctx.textAlign = 'center';
                    ctx.fillText(currentChar, charX, previewCanvas.height / 2);
                }

                if (grid) {
                    ctx.strokeStyle = invert ? '#333333' : '#dddddd';
                    for (let x = 0; x <= charCount * gridSize; x++) {
                        const lineX = x * previewScale;
                        ctx.beginPath();
                        ctx.moveTo(lineX, 0);
                        ctx.lineTo(lineX, previewCanvas.height);
                        ctx.lineWidth = x % gridSize === 0 ? 2 : 1;
                        ctx.stroke();
                    }
                    for (let y = 0; y <= gridSize; y++) {
                        const lineY = y * previewScale;
                        ctx.beginPath();
                        ctx.moveTo(0, lineY);
                        ctx.lineTo(previewCanvas.width, lineY);
                        ctx.lineWidth = 1;
                        ctx.stroke();
                    }
                }
            }

            function buildCountdownCode(selectedDate) {
                const label = getCountdownLabel();
                const year = selectedDate.getFullYear();
                const month = selectedDate.getMonth() + 1;
                const day = selectedDate.getDate();
                const bytes = [
                    0xD6,
                    getCountdownStyle(),
                    year & 0xFF,
                    (year >> 8) & 0xFF,
                    month,
                    day,
                    label.length
                ];

                for (let i = 0; i < label.length; i++) {
                    bytes.push(label.charCodeAt(i) & 0x7F);
                }

                return bytes.map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
            }

            function sendcode() {
                triggerRxTxCmd('E102');
            }

            function generateCode() {
                if (!datePicker.value) {
                    addLog('Hãy chọn ngày đếm ngược');
                    return;
                }

                const selectedDate = new Date(`${datePicker.value}T00:00:00`);
                if (Number.isNaN(selectedDate.getTime())) {
                    addLog('Ngày đếm ngược không hợp lệ');
                    return;
                }

                const year = selectedDate.getFullYear();
                if (year < 2000 || year > 2099) {
                    addLog('Ngày đếm ngược phải trong khoảng 2000–2099');
                    return;
                }

                const code = buildCountdownCode(selectedDate);
                if (codeOutput) {
                    codeOutput.value = code;
                }
                triggerRxTxCmd(code);
            }

            textInput.addEventListener('input', drawPreview);
            fontFamily.addEventListener('change', drawPreview);
            invertColors.addEventListener('change', drawPreview);
            showGrid.addEventListener('change', drawPreview);
        })();

// ---- slider value labels ----
        document.getElementById('brightness').addEventListener('input', function() {
            document.getElementById('brightnessValue').textContent = this.value;
        });
        document.getElementById('contrast').addEventListener('input', function() {
            document.getElementById('contrastValue').textContent = this.value;
        });
        document.getElementById('saturation').addEventListener('input', function() {
            document.getElementById('saturationValue').textContent = this.value;
        });
        document.getElementById('diffusion').addEventListener('input', function() {
            document.getElementById('diffusionValue').textContent = this.value;
        });
