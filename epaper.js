// 颜色 palette 定义
const bwrPalette = [
	[0, 0, 0, 255],     // 黑色
	[255, 255, 255, 255], // 白色
	[255, 0, 0, 255]    // 红色
];

const bwPalette = [
	[0, 0, 0, 255],     // 黑色
	[255, 255, 255, 255]  // 白色
];

// 文本相关变量
let currentTextColor = "black";
let currentFontFamily = "Arial"; // 默认字体
let textElements = []; // 保存已添加的文本
let draggingTextIndex = -1; // 当前拖拽的文本索引
let canvasScale = 1; // 画布缩放比例

// 蓝牙及画布相关变量
let bleDevice;
let gattServer;
let epdService;
let rxtxService;
let epdCharacteristic;
let rxtxCharacteristic;
let reconnectTrys = 0;
const my_step = 900;
let currentCanvasWidth = 300;
let currentCanvasHeight = 400;
let rotationAngle = 0;
let originalImage = null;
let canvasImageData = null; // 保存画布背景图数据，解决残影

// 初始化页面
document.addEventListener('DOMContentLoaded', function() {
	// 初始化画布事件
	const canvas = document.getElementById('processed-preview');
	canvas.addEventListener('mousedown', startDragText);
	document.addEventListener('mousemove', dragText);
	document.addEventListener('mouseup', endDragText);
	window.addEventListener('resize', updateCanvasScale);

	// 字体选择事件
	document.getElementById('font-family').addEventListener('change', function() {
		currentFontFamily = this.value;
		addLog(`已选择字体: ${getFontDisplayName(currentFontFamily)}`);
	});

	// 尺寸选择事件
	document.querySelectorAll('.size-option').forEach(option => {
		option.addEventListener('click', function() {
			document.querySelectorAll('.size-option').forEach(opt => opt.classList.remove('selected'));
			this.classList.add('selected');
			
			currentCanvasWidth = parseInt(this.dataset.width);
			currentCanvasHeight = parseInt(this.dataset.height);
			
			const canvas = document.getElementById('canvas');
			canvas.width = currentCanvasWidth;
			canvas.height = currentCanvasHeight;
			
			const processedPreview = document.getElementById('processed-preview');
			processedPreview.width = currentCanvasWidth;
			processedPreview.height = currentCanvasHeight;
			
			// 清空画布并更新背景数据
			const ctx = canvas.getContext('2d');
			ctx.fillStyle = 'white';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			canvasImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
			
			addLog(`已选择屏幕尺寸: ${currentCanvasWidth}x${currentCanvasHeight}`);
			
			// 重新绘制图片和文本
			if (originalImage) {
				drawRotatedAndStretchedImage();
			}
			updateCanvasScale();
		});
	});

	// 旋转控制事件
	document.querySelectorAll('.rotation-control').forEach(btn => {
		btn.addEventListener('click', function() {
			if (!originalImage && textElements.length === 0) {
				addLog('请先上传图片或添加文本再进行旋转操作');
				return;
			}
			
			document.querySelectorAll('.rotation-control').forEach(b => b.classList.remove('selected'));
			this.classList.add('selected');
			
			// 计算旋转角度差
			const newRotationAngle = parseInt(this.dataset.angle);
			const rotationDiff = newRotationAngle - rotationAngle;
			rotationAngle = newRotationAngle;
			
			addLog(`图片旋转 ${rotationAngle}°，文字将同步旋转`);
			
			// 旋转所有文字
			rotateAllText(rotationDiff);
			
			// 重新绘制图片和文本
			if (originalImage) {
				drawRotatedAndStretchedImage();
			} else {
				redrawAllText();
			}
			
			updatePreviewRotation();
			updateCanvasScale();
		});
	});

	// 文本颜色选择事件
	document.querySelectorAll('.color-option').forEach(option => {
		option.addEventListener('click', function() {
			document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
			this.classList.add('selected');
			currentTextColor = this.dataset.color;
		});
	});

	// 初始化画布
	const mainCanvas = document.getElementById('canvas');
	const ctx = mainCanvas.getContext('2d');
	ctx.fillStyle = 'white';
	ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
	canvasImageData = ctx.getImageData(0, 0, mainCanvas.width, mainCanvas.height);
	
	document.getElementById("disconnectbutton").style.display = 'none';
	updateCanvasScale();
});

// 辅助函数：获取字体显示名称
function getFontDisplayName(fontFamily) {
	const fontMap = {
		"Arial": "Arial (无衬线)",
		"SimSun": "宋体 (中文字体)",
		"Microsoft YaHei": "微软雅黑 (中文字体)",
		"Courier New": "Courier New (等宽字体)",
		"Georgia": "Georgia (衬线字体)"
	};
	return fontMap[fontFamily] || fontFamily;
}

// 计算画布缩放比例
function updateCanvasScale() {
	const canvas = document.getElementById('processed-preview');
	if (!canvas) return;
	
	const rect = canvas.getBoundingClientRect();
	canvasScale = canvas.width / rect.width;
}

// 旋转所有文字
function rotateAllText(angleDiff) {
	if (textElements.length === 0 || angleDiff === 0) return;
	
	const centerX = currentCanvasWidth / 2;
	const centerY = currentCanvasHeight / 2;
	
	textElements.forEach(text => {
		// 计算文字到中心点的相对位置
		const dx = text.x - centerX;
		const dy = text.y - centerY;
		
		// 转换角度为弧度
		const angle = angleDiff * Math.PI / 180;
		
		// 旋转坐标
		const newX = dx * Math.cos(angle) - dy * Math.sin(angle);
		const newY = dx * Math.sin(angle) + dy * Math.cos(angle);
		
		// 更新文字位置（相对于新的中心点）
		text.x = centerX + newX;
		text.y = centerY + newY;
	});
	
	addLog(`已将所有文字旋转 ${angleDiff}°`);
}

// 开始拖拽文本
function startDragText(e) {
	if (textElements.length === 0) return;
	
	const canvas = document.getElementById('processed-preview');
	const rect = canvas.getBoundingClientRect();
	const mouseX = (e.clientX - rect.left) * canvasScale;
	const mouseY = (e.clientY - rect.top) * canvasScale;
	
	// 检查是否点击在文本区域内
	const ctx = canvas.getContext('2d');
	for (let i = textElements.length - 1; i >= 0; i--) {
		const text = textElements[i];
		ctx.font = `${text.fontSize}px ${text.fontFamily}`;
		const textWidth = ctx.measureText(text.text).width;
		const textHeight = text.fontSize * 1.2;
		
		// 扩大点击范围，提高易用性
		const padding = 5;
		const isInTextArea = 
			mouseX >= text.x - textWidth/2 - padding &&
			mouseX <= text.x + textWidth/2 + padding &&
			mouseY >= text.y - textHeight/2 - padding &&
			mouseY <= text.y + textHeight/2 + padding;
		
		if (isInTextArea) {
			// 更新拖拽状态
			draggingTextIndex = i;
			textElements[i].isDragging = true;
			textElements[i].offsetX = mouseX - text.x;
			textElements[i].offsetY = mouseY - text.y;
			
			canvas.classList.add('dragging-cursor');
			addLog(`选中文本: "${text.text}"，可拖拽调整位置`);
			return;
		}
	}
}

// 拖拽文本
function dragText(e) {
	if (draggingTextIndex === -1) return;
	
	const canvas = document.getElementById('processed-preview');
	const rect = canvas.getBoundingClientRect();
	const mouseX = (e.clientX - rect.left) * canvasScale;
	const mouseY = (e.clientY - rect.top) * canvasScale;
	
	// 更新文本位置
	textElements[draggingTextIndex].x = mouseX - textElements[draggingTextIndex].offsetX;
	textElements[draggingTextIndex].y = mouseY - textElements[draggingTextIndex].offsetY;
	
	// 限制文本在画布范围内
	const text = textElements[draggingTextIndex];
	text.x = Math.max(0, Math.min(canvas.width, text.x));
	text.y = Math.max(0, Math.min(canvas.height, text.y));
	
	// 重绘所有内容
	redrawAllText();
	updateProcessedPreview();
}

// 结束拖拽文本
function endDragText() {
	if (draggingTextIndex !== -1) {
		textElements[draggingTextIndex].isDragging = false;
		addLog(`文本位置已更新: (${textElements[draggingTextIndex].x.toFixed(0)}, ${textElements[draggingTextIndex].y.toFixed(0)})`);
		draggingTextIndex = -1;
		document.getElementById('processed-preview').classList.remove('dragging-cursor');
	}
}

// 添加文本到画布中心
function addTextToCanvas() {
	const text = document.getElementById('text-input').value.trim();
	if (!text) {
		addLog('请输入要添加的文字');
		return;
	}

	const canvas = document.getElementById('canvas');
	const ctx = canvas.getContext('2d');
	const fontSize = parseInt(document.getElementById('font-size').value);
	const fontFamily = currentFontFamily;
	
	// 计算初始位置（居中显示）
	const x = canvas.width / 2;
	const y = canvas.height / 2;

	// 保存文本信息
	textElements.push({
		text: text,
		x: x,
		y: y,
		fontSize: fontSize,
		fontFamily: fontFamily,
		color: currentTextColor,
		isDragging: false,
		offsetX: 0,
		offsetY: 0
	});

	// 绘制文本
	drawText(ctx, text, x, y, fontSize, fontFamily, currentTextColor, false);

	// 更新预览
	updateProcessedPreview();
	addLog(`已添加文本: "${text}" (字体: ${getFontDisplayName(fontFamily)}, 大小: ${fontSize}px, 颜色: ${currentTextColor})`);
}

// 绘制单个文本
function drawText(ctx, text, x, y, fontSize, fontFamily, color, isDragging = false) {
	ctx.save();
	
	// 应用所选字体
	ctx.font = `${fontSize}px ${fontFamily}`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	
	// 拖拽状态时绘制边框
	if (isDragging) {
		const textWidth = ctx.measureText(text).width;
		const textHeight = fontSize * 1.2;
		
		ctx.strokeStyle = 'blue';
		ctx.lineWidth = 1;
		ctx.strokeRect(x - textWidth/2 - 3, y - textHeight/2 - 3, textWidth + 6, textHeight + 6);
	}
	
	// 设置文本颜色
	switch(color) {
		case 'black':
			ctx.fillStyle = 'black';
			break;
		case 'white':
			ctx.fillStyle = 'white';
			break;
		case 'red':
			ctx.fillStyle = 'red';
			break;
	}
	
	ctx.fillText(text, x, y);
	ctx.restore();
}

// 重绘所有文本
function redrawAllText() {
	if (textElements.length === 0) return;

	const canvas = document.getElementById('canvas');
	const ctx = canvas.getContext('2d');
	
	// 恢复背景（清除所有内容）
	if (canvasImageData) {
		ctx.putImageData(canvasImageData, 0, 0);
	} else {
		ctx.fillStyle = 'white';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
	}

	// 重新绘制所有文本
	textElements.forEach((text) => {
		drawText(
			ctx, 
			text.text, 
			text.x, 
			text.y, 
			text.fontSize, 
			text.fontFamily, 
			text.color, 
			text.isDragging
		);
	});

	// 更新预览
	updateProcessedPreview();
}

// 绘制旋转和拉伸的图片，并保存背景数据
function drawRotatedAndStretchedImage() {
	if (!originalImage) return;
	
	const canvas = document.getElementById('canvas');
	const ctx = canvas.getContext('2d');
	
	// 清空画布
	ctx.fillStyle = 'white';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	
	// 保存上下文状态
	ctx.save();
	
	// 计算旋转后的有效宽高
	let effectiveWidth, effectiveHeight;
	const swapDimensions = rotationAngle === 90 || rotationAngle === 270;
	if (swapDimensions) {
		effectiveWidth = canvas.height;
		effectiveHeight = canvas.width;
	} else {
		effectiveWidth = canvas.width;
		effectiveHeight = canvas.height;
	}
	
	// 计算拉伸比例
	const scaleX = effectiveWidth / originalImage.width;
	const scaleY = effectiveHeight / originalImage.height;
	
	// 根据旋转角度设置变换
	switch(rotationAngle) {
		case 0:
			ctx.translate(0, 0);
			break;
		case 90:
			ctx.translate(0, canvas.height);
			ctx.rotate(-Math.PI / 2);
			break;
		case 180:
			ctx.translate(canvas.width, canvas.height);
			ctx.rotate(Math.PI);
			break;
		case 270:
			ctx.translate(canvas.width, 0);
			ctx.rotate(Math.PI / 2);
			break;
	}
	
	// 绘制图片
	ctx.drawImage(
		originalImage, 
		0, 0, originalImage.width, originalImage.height,
		0, 0, 
		originalImage.width * scaleX, 
		originalImage.height * scaleY
	);
	
	// 恢复上下文状态
	ctx.restore();
	
	// 保存当前画布（不含文字）作为背景数据
	canvasImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	
	// 重新绘制所有文本
	redrawAllText();
	
	// 应用抖动处理
	convert_dithering();
}

// 更新处理后预览
function updateProcessedPreview() {
	const canvas = document.getElementById('canvas');
	const processedPreview = document.getElementById('processed-preview');
	const processedPlaceholder = document.getElementById('processed-placeholder');
	
	processedPreview.style.display = 'block';
	processedPlaceholder.style.display = 'none';
	
	const ctx = processedPreview.getContext('2d');
	// 先清除预览画布
	ctx.clearRect(0, 0, processedPreview.width, processedPreview.height);
	// 再绘制最新内容
	ctx.drawImage(canvas, 0, 0);
}

// 更新预览容器旋转
function updatePreviewRotation() {
	const container = document.getElementById('processed-rotating-container');
	const previewCanvas = document.getElementById('processed-preview');
	
	switch(rotationAngle) {
		case 0:
			container.style.transform = 'rotate(0deg)';
			previewCanvas.style.maxWidth = '100%';
			previewCanvas.style.maxHeight = '300px';
			break;
		case 90:
			container.style.transform = 'rotate(90deg)';
			previewCanvas.style.maxWidth = '300px';
			previewCanvas.style.maxHeight = '100%';
			break;
		case 180:
			container.style.transform = 'rotate(180deg)';
			previewCanvas.style.maxWidth = '100%';
			previewCanvas.style.maxHeight = '300px';
			break;
		case 270:
			container.style.transform = 'rotate(270deg)';
			previewCanvas.style.maxWidth = '300px';
			previewCanvas.style.maxHeight = '100%';
			break;
	}
	updateCanvasScale();
}

// 以下为其他辅助函数（与之前相同）
function delay(delayInms) {
	return new Promise(resolve => {
		setTimeout(() => {
			resolve(2);
		}, delayInms);
	});
}

function resetVariables() {
	gattServer = null;
	epdService = null;
	epdCharacteristic = null;
	rxtxCharacteristic = null;
	rxtxService = null;
}

async function handleError(error) {
	console.log(error);
	addLog(`错误: ${error.message || error}`);
	resetVariables();
	if (bleDevice == null)
		return;
	if (reconnectTrys <= 5) {
		reconnectTrys++;
		addLog(`尝试重新连接 (${reconnectTrys}/5)`);
		await connect();
	} else {
		addLog("连接失败，已终止尝试");
		reconnectTrys = 0;
		document.getElementById('connectbutton').style.display = 'inline-block';
		document.getElementById('disconnectbutton').style.display = 'none';
	}
}

async function sendCommand(cmd) {
	if (epdCharacteristic) {
		await epdCharacteristic.writeValueWithResponse(cmd)
	} else {
		addLog('服务不可用。蓝牙连接上了吗？')
	}
}

async function rxTxSendCommand(cmd) {
	if (rxtxCharacteristic) {
		await rxtxCharacteristic.writeValueWithResponse(cmd);
	} else {
		addLog('服务不可用。蓝牙连接上了吗？')
	}
}

async function rxTxSendCommand2(cmd) {
	if (rxtxCharacteristic) {
		await rxtxCharacteristic.writeValueWith(cmd);
	} else {
		addLog('服务不可用。蓝牙连接上了吗？')
	}
}

async function sendBufferData(value, type) {
	addLog(`开始发送图片模式:${type}, 大小 ${(value.length/2).toFixed(2)}byte`);
	let code = 'ff';
	if (type === 'bwr') {
		code = '00';
	}
	const step = my_step;
	let partIndex = 0;
	for (let i = 0; i < value.length; i += step) {
		addLog(`正在发送第${partIndex+1}块. 起始位置: ${i/2}`);
		await sendCommand(hexToBytes("03" + code + intToHex(i / 2, 2) + value.substring(i, i + step)));
		partIndex += 1;
	}
}

async function upload_image() {
	if (!epdCharacteristic) {
		addLog('请先连接蓝牙设备');
		return;
	}
	
	const canvas = document.getElementById('canvas');
	
	// 检查画布是否为空
	const ctx = canvas.getContext('2d');
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	let isEmpty = true;
	for (let i = 0; i < imageData.data.length; i += 4) {
		if (imageData.data[i] !== 255 || imageData.data[i+1] !== 255 || imageData.data[i+2] !== 255) {
			isEmpty = false;
			break;
		}
	}
	
	if (isEmpty) {
		addLog('画布为空，请先上传或处理图片');
		return;
	}

	const startTime = new Date().getTime();

	await sendCommand(hexToBytes("0000"));
	await sendCommand(hexToBytes("020000"));

	await sendBufferData(bytesToHex(canvas2bytes(canvas)), 'bw');
	await sendBufferData(bytesToHex(canvas2bytes(canvas, 'bwr')), 'bwr');

	await sendCommand(hexToBytes("0101"));

	addLog(`上传完成，耗时${((new Date().getTime() - startTime)/1000).toFixed(2)}s`);
}

function disconnect() {
	if (bleDevice && bleDevice.gatt.connected) {
		bleDevice.gatt.disconnect();
	}
	resetVariables();
	addLog('连接已断开.');
	document.getElementById("connectbutton").style.display = 'inline-block';
	document.getElementById("disconnectbutton").style.display = 'none';
}

async function preConnect() {
	if (gattServer != null && gattServer.connected) {
		disconnect();
		return;
	}
	
	reconnectTrys = 0;
	try {
		const filterType = document.getElementById('device-filter').value;
		let filters = [];
		
		if (filterType === 'nrf') {
			filters = [{ namePrefix: 'NRF' }];
			addLog('正在搜索NRF开头的蓝牙设备...');
		} else {
			addLog('正在搜索所有蓝牙设备...');
		}
		
		bleDevice = await navigator.bluetooth.requestDevice({ 
			optionalServices: [
				'0000221f-0000-1000-8000-00805f9b34fb', 
				'00001f10-0000-1000-8000-00805f9b34fb', 
				'13187b10-eba9-a3ba-044e-83d3217d9a38'
			],
			filters: filters.length > 0 ? filters : undefined,
			acceptAllDevices: filters.length === 0
		});
		
		addLog(`找到设备: ${bleDevice.name || '未知设备'}`);
		bleDevice.addEventListener('gattserverdisconnected', onDisconnected);
		await connect();
	} catch (e) {
		addLog(`连接取消或失败: ${e.message}`);
	}
}

function onDisconnected() {
	addLog('设备已断开连接');
	resetVariables();
	document.getElementById("connectbutton").style.display = 'inline-block';
	document.getElementById("disconnectbutton").style.display = 'none';
}

async function connectRXTX() {
	rxtxService = await gattServer.getPrimaryService('00001f10-0000-1000-8000-00805f9b34fb');
	addLog('> 找到串口服务');

	rxtxCharacteristic = await rxtxService.getCharacteristic('00001f1f-0000-1000-8000-00805f9b34fb');
	addLog('> 串口服务已连接');
}

async function reConnect() {
	if (!bleDevice) {
		addLog('请先搜索并连接设备');
		return;
	}
	
	connectTrys = 0;
	if (bleDevice.gatt.connected)
		bleDevice.gatt.disconnect();
	resetVariables();
	addLog("重新连接中...");
	setTimeout(async function () { await connect(); }, 300);
}

async function connect() {
	if (epdCharacteristic == null && bleDevice) {
		addLog("正在连接: " + (bleDevice.name || '未知设备'));

		try {
			gattServer = await bleDevice.gatt.connect();
			addLog('> 找到GATT服务器');

			epdService = await gattServer.getPrimaryService('13187b10-eba9-a3ba-044e-83d3217d9a38');
			addLog('> 找到可用服务');

			epdCharacteristic = await epdService.getCharacteristic('4b646063-6264-f3a7-8941-e65356ea82fe');
			addLog('> 服务已连接');

			await epdCharacteristic.startNotifications();

			epdCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
				console.log('epd ret', bytesToHex(event.target.value.buffer));
				const count = parseInt('0x' + bytesToHex(event.target.value.buffer));
				
				addLog(`> [来自屏幕]: 收到${count} byte数据`);
			});

			document.getElementById("connectbutton").style.display = 'none';
			document.getElementById("disconnectbutton").style.display = 'inline-block';
			
			await connectRXTX();
		} catch (error) {
			await handleError(error);
		}
	}
}

function addLog(logTXT) {
	const today = new Date();
	const time = ("0" + today.getHours()).slice(-2) + ":" + 
				 ("0" + today.getMinutes()).slice(-2) + ":" + 
				 ("0" + today.getSeconds()).slice(-2);

	const dom = document.getElementById('log');
	const logEntry = document.createElement('div');
	logEntry.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-message">${logTXT}</span>`;
	dom.appendChild(logEntry);
	dom.scrollTop = dom.scrollHeight;
}

async function update_image () {
	const image_file = document.getElementById('image_file');
	if (image_file.files.length > 0) {
		const file = image_file.files[0];

		// 显示原始图片预览
		const originalPreview = document.getElementById('original-preview');
		const img = new Image();
		img.src = URL.createObjectURL(file);
		img.onload = function() {
			originalPreview.innerHTML = '';
			img.style.maxWidth = '100%';
			img.style.maxHeight = '300px';
			originalPreview.appendChild(img);
		};

		// 加载图片到画布
		const image = new Image();
		image.src = URL.createObjectURL(file);
		image.onload = function() {
			URL.revokeObjectURL(this.src);
			originalImage = this;
			rotationAngle = 0;
			document.querySelectorAll('.rotation-control').forEach(b => b.classList.remove('selected'));
			document.querySelector('.rotation-control[data-angle="0"]').classList.add('selected');
			drawRotatedAndStretchedImage();
			updatePreviewRotation();
		};
	}
}

function clear_canvas() {
	if(confirm('确认清除画布?')) {
		const canvas = document.getElementById('canvas');
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = 'white';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		
		// 重置变量
		originalImage = null;
		rotationAngle = 0;
		textElements = [];
		draggingTextIndex = -1;
		document.getElementById('text-input').value = '';
		document.querySelectorAll('.rotation-control').forEach(b => b.classList.remove('selected'));
		document.querySelector('.rotation-control[data-angle="0"]').classList.add('selected');
		
		// 重置背景缓存
		canvasImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		
		// 重置预览
		document.getElementById('original-preview').innerHTML = '<div class="placeholder">请上传图片</div>';
		document.getElementById('processed-preview').style.display = 'none';
		document.getElementById('processed-placeholder').style.display = 'flex';
		document.getElementById('processed-preview').classList.remove('dragging-cursor');
		updatePreviewRotation();
		
		addLog('已清空画布和文本');
	}
}

function convert_dithering() {
	const canvas = document.getElementById('canvas');
	const ctx = canvas.getContext("2d");
	const mode = document.getElementById('dithering').value;
	
	if (mode.startsWith('bwr')) {
		ditheringCanvasByPalette(canvas, bwrPalette, mode);
	} else {
		dithering(ctx, canvas.width, canvas.height, parseInt(document.getElementById('threshold').value), mode);
	}
	
	// 更新处理后预览
	updateProcessedPreview();
}

function dithering(ctx, width, height, threshold, type) {
	const bayerThresholdMap = [
		[  15, 135,  45, 165 ],
		[ 195,  75, 225, 105 ],
		[  60, 180,  30, 150 ],
		[ 240, 120, 210,  90 ]
	];

	const lumR = [];
	const lumG = [];
	const lumB = [];
	for (let i = 0; i < 256; i++) {
		lumR[i] = i * 0.299;
		lumG[i] = i * 0.587;
		lumB[i] = i * 0.114;
	}
	const imageData = ctx.getImageData(0, 0, width, height);
	const imageDataLength = imageData.data.length;

	// 灰度转换
	for (let i = 0; i <= imageDataLength; i += 4) {
		imageData.data[i] = Math.floor(lumR[imageData.data[i]] + lumG[imageData.data[i+1]] + lumB[imageData.data[i+2]]);
	}

	const w = imageData.width;
	let newPixel, err;

	for (let currentPixel = 0; currentPixel <= imageDataLength; currentPixel += 4) {

		if (type === "none") {
			imageData.data[currentPixel] = imageData.data[currentPixel] < threshold ? 0 : 255;
		} else if (type === "bayer") {
			var x = (currentPixel / 4) % w;
			var y = Math.floor((currentPixel / 4) / w);
			var map = Math.floor((imageData.data[currentPixel] + bayerThresholdMap[x % 4][y % 4]) / 2);
			imageData.data[currentPixel] = (map < threshold) ? 0 : 255;
		} else if (type === "floydsteinberg") {
			newPixel = imageData.data[currentPixel] < 129 ? 0 : 255;
			err = Math.floor((imageData.data[currentPixel] - newPixel) / 16);
			imageData.data[currentPixel] = newPixel;

			if (currentPixel + 4 < imageDataLength)
				imageData.data[currentPixel + 4] += err * 7;
			if (currentPixel + 4 * w - 4 >= 0 && currentPixel + 4 * w - 4 < imageDataLength)
				imageData.data[currentPixel + 4 * w - 4] += err * 3;
			if (currentPixel + 4 * w < imageDataLength)
				imageData.data[currentPixel + 4 * w] += err * 5;
			if (currentPixel + 4 * w + 4 < imageDataLength)
				imageData.data[currentPixel + 4 * w + 4] += err * 1;
		} else {
			newPixel = imageData.data[currentPixel] < threshold ? 0 : 255;
			err = Math.floor((imageData.data[currentPixel] - newPixel) / 8);
			imageData.data[currentPixel] = newPixel;

			if (currentPixel + 4 < imageDataLength)
				imageData.data[currentPixel + 4] += err;
			if (currentPixel + 8 < imageDataLength)
				imageData.data[currentPixel + 8] += err;
			if (currentPixel + 4 * w - 4 >= 0 && currentPixel + 4 * w - 4 < imageDataLength)
				imageData.data[currentPixel + 4 * w - 4] += err;
			if (currentPixel + 4 * w < imageDataLength)
				imageData.data[currentPixel + 4 * w] += err;
			if (currentPixel + 4 * w + 4 < imageDataLength)
				imageData.data[currentPixel + 4 * w + 4] += err;
			if (currentPixel + 8 * w < imageDataLength)
				imageData.data[currentPixel + 8 * w] += err;
		}

		imageData.data[currentPixel + 1] = imageData.data[currentPixel + 2] = imageData.data[currentPixel];
	}

	ctx.putImageData(imageData, 0, 0);
}

function canvas2bytes(canvas, type = 'bw') {
	const ctx = canvas.getContext("2d");
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

	const arr = [];
	let buffer = [];

	for (let x = canvas.width - 1; x >= 0; x--) {
		for (let y = 0; y < canvas.height; y++) {
			const index = (canvas.width * 4 * y) + x * 4;
			if (type !== 'bwr') {
				buffer.push(imageData.data[index] > 0 && imageData.data[index+1] > 0 && imageData.data[index+2] > 0 ? 1 : 0);
			} else {
				buffer.push(imageData.data[index] > 0 && imageData.data[index+1] === 0 && imageData.data[index+2] === 0 ? 1 : 0);
			}

			if (buffer.length === 8) {
				arr.push(parseInt(buffer.join(''), 2));
				buffer = [];
			}
		}
	}
	return arr;
}

function getColorDistance(rgba1, rgba2) {
	const [r1, g1, b1] = rgba1;
	const [r2, g2, b2] = rgba2;

	const rm = (r1 + r2) / 2;

	const r = r1 - r2;
	const g = g1 - g2;
	const b = b1 - b2;

	return Math.sqrt((2 + rm / 256) * r * r + 4 * g * g + (2 + (255 - rm) / 256) * b * b);
}

function getNearColorV2(color, palette) {
	let minDistanceSquared = 255*255 + 255*255 + 255*255 + 1;

	let bestIndex = 0;
	for (let i = 0; i < palette.length; i++) {
		let rdiff = (color[0] & 0xff) - (palette[i][0] & 0xff);
		let gdiff = (color[1] & 0xff) - (palette[i][1] & 0xff);
		let bdiff = (color[2] & 0xff) - (palette[i][2] & 0xff);
		let distanceSquared = rdiff*rdiff + gdiff*gdiff + bdiff*bdiff;
		if (distanceSquared < minDistanceSquared) {
			minDistanceSquared = distanceSquared;
			bestIndex = i;
		}
	}
	return palette[bestIndex];
}

function updatePixel(imageData, index, color) {
	imageData[index] = color[0];
	imageData[index+1] = color[1];
	imageData[index+2] = color[2];
	imageData[index+3] = color[3];
}

function getColorErr(color1, color2, rate) {
	const res = [];
	for (let i = 0; i < 3; i++) {
		res.push(Math.floor((color1[i] - color2[i]) / rate));
	}
	return res;
}

function updatePixelErr(imageData, index, err, rate) {
	imageData[index] = Math.max(0, Math.min(255, imageData[index] + err[0] * rate));
	imageData[index+1] = Math.max(0, Math.min(255, imageData[index+1] + err[1] * rate));
	imageData[index+2] = Math.max(0, Math.min(255, imageData[index+2] + err[2] * rate));
}

function ditheringCanvasByPalette(canvas, palette, type) {
	palette = palette || bwrPalette;

	const ctx = canvas.getContext('2d');
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const w = imageData.width;
	const dataLength = imageData.data.length;

	for (let currentPixel = 0; currentPixel < dataLength; currentPixel += 4) {
		const currentColor = [
			imageData.data[currentPixel],
			imageData.data[currentPixel + 1],
			imageData.data[currentPixel + 2],
			imageData.data[currentPixel + 3]
		];
		
		const newColor = getNearColorV2(currentColor, palette);

		if (type === "bwr_floydsteinberg") {
			const err = getColorErr(currentColor, newColor, 16);

			updatePixel(imageData.data, currentPixel, newColor);
			
			if (currentPixel + 4 < dataLength)
				updatePixelErr(imageData.data, currentPixel + 4, err, 7);
			if (currentPixel + 4 * w - 4 >= 0 && currentPixel + 4 * w - 4 < dataLength)
				updatePixelErr(imageData.data, currentPixel + 4 * w - 4, err, 3);
			if (currentPixel + 4 * w < dataLength)
				updatePixelErr(imageData.data, currentPixel + 4 * w, err, 5);
			if (currentPixel + 4 * w + 4 < dataLength)
				updatePixelErr(imageData.data, currentPixel + 4 * w + 4, err, 1);
		} else {
			const err = getColorErr(currentColor, newColor, 8);

			updatePixel(imageData.data, currentPixel, newColor);
			
			if (currentPixel + 4 < dataLength)
				updatePixelErr(imageData.data, currentPixel + 4, err, 1);
			if (currentPixel + 8 < dataLength)
				updatePixelErr(imageData.data, currentPixel + 8, err, 1);
			if (currentPixel + 4 * w - 4 >= 0 && currentPixel + 4 * w - 4 < dataLength)
				updatePixelErr(imageData.data, currentPixel + 4 * w - 4, err, 1);
			if (currentPixel + 4 * w < dataLength)
				updatePixelErr(imageData.data, currentPixel + 4 * w, err, 1);
			if (currentPixel + 4 * w + 4 < dataLength)
				updatePixelErr(imageData.data, currentPixel + 4 * w + 4, err, 1);
			if (currentPixel + 8 * w < dataLength)
				updatePixelErr(imageData.data, currentPixel + 8 * w, err, 1);
		}
	}
	ctx.putImageData(imageData, 0, 0);
}

function bytesToHex(bytes) {
	if (!bytes) return '';
	bytes = new Uint8Array(bytes);
	return Array.from(bytes, byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');
}

function hexToBytes(hex) {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
	}
	return bytes;
}

function intToHex(int, bytes) {
	let hex = int.toString(16);
	while (hex.length < bytes * 2) {
		hex = '0' + hex;
	}
	return hex.slice(-bytes * 2);
}