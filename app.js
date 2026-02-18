// ==========================================
// 1. DOM 요소 가져오기
// ==========================================
const landingPage = document.getElementById("landing-page");
const cameraPage = document.getElementById("camera-page");
const resultPage = document.getElementById("result-page");

const video = document.getElementById("video");
const canvas = document.getElementById("outputCanvas");
const scannedImage = document.getElementById("scannedImage");
const guideBox = document.querySelector(".camera-guide-box");

const startCaptureBtn = document.getElementById("startCaptureBtn");
const shutterBtn = document.getElementById("shutterBtn");
const closeCameraBtn = document.getElementById("closeCameraBtn");
const retakeBtn = document.getElementById("retakeBtn");
const saveBtn = document.getElementById("saveBtn");

let stream = null;
let detectReq = null;
let isCapturing = false;
let isScanningActive = false; // ★ 탐색 엔진 가동 여부
let stableCount = 0;
let lastGoodCoords = null;

// ==========================================
// 2. 카메라 제어 (엔진은 대기 상태)
// ==========================================
async function startCamera() {
  if (!window.isOpenCvReady) {
    alert("엔진 로드 중입니다. 잠시만 기다려주세요.");
    return;
  }

  try {
    landingPage.style.display = "none";
    resultPage.style.display = "none";
    cameraPage.style.display = "flex";

    const constraints = {
      video: {
        facingMode: "environment",
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
      audio: false,
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    video.setAttribute("playsinline", true);
    video.play();

    // 초기화
    isCapturing = false;
    isScanningActive = false;
    stableCount = 0;
    guideBox.className = "camera-guide-box"; // 모든 CSS 클래스 초기화

    // ★ (추가) 카메라 켤 때 촬영 버튼 다시 보이게 만들기
    shutterBtn.style.display = "block";

    // ★ 여기서 바로 탐색을 시작하지 않고 화면만 띄워둡니다.
  } catch (err) {
    alert("카메라 권한을 허용해주세요.");
    closeCamera();
  }
}

function closeCamera() {
  if (detectReq) cancelAnimationFrame(detectReq);
  isCapturing = true;
  isScanningActive = false;

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  video.srcObject = null;
  cameraPage.style.display = "none";
  landingPage.style.display = "block";
  guideBox.className = "camera-guide-box";
}

// ==========================================
// 3. 셔터 버튼 클릭 제어 (핵심 변경점)
// ==========================================
function onShutterBtnClick() {
  if (isCapturing) return;

  if (!isScanningActive) {
    // 대기 상태에서 처음 눌렀을 때 -> 자동 탐색 시작
    isScanningActive = true;
    stableCount = 0;
    window.missedCount = 0;

    guideBox.classList.add("scanning"); // '탐색 중...' UI로 변경

    // ★ 버튼 숨기기 (직접 촬영 완전 차단)
    shutterBtn.style.display = "none";

    detectReq = requestAnimationFrame(scanDocumentLoop); // 엔진 가동!
  }
}

// ==========================================
// 4. 실시간 문서 테두리 탐색 루프
// ==========================================
function scanDocumentLoop() {
  if (!stream || isCapturing || !isScanningActive) return;

  const vW = video.videoWidth;
  const vH = video.videoHeight;

  if (vW === 0) {
    detectReq = requestAnimationFrame(scanDocumentLoop);
    return;
  }

  const scale = 800 / Math.max(vW, vH);
  const dW = Math.floor(vW * scale);
  const dH = Math.floor(vH * scale);

  if (!window.detectCanvas)
    window.detectCanvas = document.createElement("canvas");
  window.detectCanvas.width = dW;
  window.detectCanvas.height = dH;

  const ctx = window.detectCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  ctx.drawImage(video, 0, 0, dW, dH);

  let src = cv.imread(window.detectCanvas);
  let gray = new cv.Mat();
  let blurred = new cv.Mat();
  let edges = new cv.Mat();
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();

  let foundDocThisFrame = false;

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

    // ★ 사용자 튜닝 값 적용 (10, 40)
    cv.Canny(blurred, edges, 10, 40);

    // ★ [추가할 코드] 찾아낸 선을 강제로 두껍게 번지게 만들어서 끊어진 점선 이어붙이기
    let kernel = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(
      edges,
      edges,
      kernel,
      new cv.Point(-1, -1),
      1,
      cv.BORDER_CONSTANT,
      cv.morphologyDefaultBorderValue()
    );
    kernel.delete();
    // -------------------------------------------------------------------------

    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE
    );

    let maxArea = 0;
    let bestPoints = null;

    for (let i = 0; i < contours.size(); ++i) {
      let cnt = contours.get(i);
      let area = cv.contourArea(cnt);

      if (area > dW * dH * 0.15) {
        let approx = new cv.Mat();
        let peri = cv.arcLength(cnt, true);

        // 오차 허용치 (기존 0.02에서 0.03으로 살짝 넓힘 - 아이보리 책상 대비)
        cv.approxPolyDP(cnt, approx, 0.03 * peri, true);

        if (approx.rows === 4 && area > maxArea) {
          maxArea = area;
          bestPoints = [];
          for (let j = 0; j < 4; j++) {
            bestPoints.push({
              x: approx.data32S[j * 2],
              y: approx.data32S[j * 2 + 1],
            });
          }
        }
        approx.delete();
      }
    }

    if (bestPoints && bestPoints.length === 4) {
      bestPoints.sort((a, b) => a.x + a.y - (b.x + b.y));
      let tl = bestPoints[0];
      let br = bestPoints[3];

      bestPoints.sort((a, b) => a.x - a.y - (b.x - b.y));
      let bl = bestPoints[0];
      let tr = bestPoints[3];

      foundDocThisFrame = true;
      lastGoodCoords = {
        tl: { x: tl.x / scale, y: tl.y / scale },
        tr: { x: tr.x / scale, y: tr.y / scale },
        br: { x: br.x / scale, y: br.y / scale },
        bl: { x: bl.x / scale, y: bl.y / scale },
      };
    }

    if (typeof window.missedCount === "undefined") window.missedCount = 0;

    if (foundDocThisFrame) {
      stableCount++;
      window.missedCount = 0;
      guideBox.classList.add("detected");
      guideBox.classList.remove("scanning");

      if (stableCount >= 40) {
        // 대기시간
        isCapturing = true;
        executeHighResCapture(lastGoodCoords);
        return;
      }
    } else {
      window.missedCount++;
      if (window.missedCount > 5) {
        stableCount = 0;
        guideBox.classList.remove("detected");
        guideBox.classList.add("scanning"); // 다시 탐색 중 상태로
      }
    }
  } catch (err) {
    console.error("탐색 에러:", err);
  } finally {
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }

  if (!isCapturing && isScanningActive)
    detectReq = requestAnimationFrame(scanDocumentLoop);
}

// ==========================================
// 5. 고해상도 처리 및 평탄화 (자동/수동 공통)
// ==========================================
function executeHighResCapture(coords) {
  guideBox.className = "camera-guide-box";

  const vW = video.videoWidth;
  const vH = video.videoHeight;
  canvas.width = vW;
  canvas.height = vH;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, vW, vH);

  let src = cv.imread(canvas);
  let dst = new cv.Mat();
  let dsize = new cv.Size(1728, 2200);

  try {
    let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      coords.tl.x,
      coords.tl.y,
      coords.tr.x,
      coords.tr.y,
      coords.br.x,
      coords.br.y,
      coords.bl.x,
      coords.bl.y,
    ]);
    // 안쪽으로 파고들 픽셀(px) 여백 설정 (숫자를 자유롭게 조절하세요!)
    let marginX = 10; // 좌우 테두리를 각각 20px씩 잘라냄
    let marginY = 15; // 상하 테두리를 각각 25px씩 잘라냄

    let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      -marginX,
      -marginY,
      dsize.width + marginX,
      -marginY,
      dsize.width + marginX,
      dsize.height + marginY,
      -marginX,
      dsize.height + marginY,
    ]);

    let M = cv.getPerspectiveTransform(srcTri, dstTri);
    cv.warpPerspective(
      src,
      dst,
      M,
      dsize,
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar()
    );

    cv.cvtColor(dst, dst, cv.COLOR_RGBA2GRAY, 0);

    // ★ 사용자 튜닝 값 적용 (51, 7)
    cv.adaptiveThreshold(
      dst,
      dst,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      51,
      7
    );

    cv.imshow(canvas, dst);
    scannedImage.src = canvas.toDataURL("image/jpeg", 0.9);

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    cameraPage.style.display = "none";
    resultPage.style.display = "flex";

    srcTri.delete();
    dstTri.delete();
    M.delete();
  } catch (err) {
    alert("이미지 처리 중 오류가 발생했습니다.");
  } finally {
    src.delete();
    dst.delete();
  }
}

function manualFallbackCapture() {
  if (isCapturing) return;
  isCapturing = true;

  if (lastGoodCoords && guideBox.classList.contains("detected")) {
    executeHighResCapture(lastGoodCoords);
    return;
  }

  const vW = video.videoWidth;
  const vH = video.videoHeight;
  canvas.width = vW;
  canvas.height = vH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, vW, vH);

  const videoRatio = vW / vH;
  const screenRatio = video.clientWidth / video.clientHeight;
  const guideRect = guideBox.getBoundingClientRect();
  const videoRect = video.getBoundingClientRect();

  let scale,
    offsetX = 0,
    offsetY = 0;
  if (screenRatio > videoRatio) {
    scale = vW / video.clientWidth;
    offsetY = (vH - video.clientHeight * scale) / 2;
  } else {
    scale = vH / video.clientHeight;
    offsetX = (vW - video.clientWidth * scale) / 2;
  }

  let rx = (guideRect.left - videoRect.left) * scale + offsetX;
  let ry = (guideRect.top - videoRect.top) * scale + offsetY;
  let rw = guideRect.width * scale;
  let rh = guideRect.height * scale;

  let src = cv.imread(canvas);
  let dst = new cv.Mat();
  let dsize = new cv.Size(1728, 2200);

  try {
    let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      rx,
      ry,
      rx + rw,
      ry,
      rx + rw,
      ry + rh,
      rx,
      ry + rh,
    ]);
    let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0,
      0,
      dsize.width,
      0,
      dsize.width,
      dsize.height,
      0,
      dsize.height,
    ]);
    let M = cv.getPerspectiveTransform(srcTri, dstTri);
    cv.warpPerspective(
      src,
      dst,
      M,
      dsize,
      cv.INTER_LINEAR,
      cv.BORDER_CONSTANT,
      new cv.Scalar()
    );

    cv.cvtColor(dst, dst, cv.COLOR_RGBA2GRAY, 0);

    // ★ 사용자 튜닝 값 적용 (51, 7)
    cv.adaptiveThreshold(
      dst,
      dst,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      51,
      7
    );

    cv.imshow(canvas, dst);
    scannedImage.src = canvas.toDataURL("image/jpeg", 0.9);

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    cameraPage.style.display = "none";
    resultPage.style.display = "flex";

    srcTri.delete();
    dstTri.delete();
    M.delete();
  } catch (e) {
    alert("캡처에 실패했습니다.");
  } finally {
    src.delete();
    dst.delete();
  }
}

// ==========================================
// 6. 결과 화면 동작 (다시찍기/저장)
// ==========================================
function retakePhoto() {
  resultPage.style.display = "none";
  startCamera();
}

function saveImage() {
  try {
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const tiffUint8Array = UTIF.encodeImage(
      imageData.data,
      canvas.width,
      canvas.height
    );
    const blob = new Blob([tiffUint8Array], { type: "image/tiff" });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T.]/g, "")
      .slice(0, 14);
    link.download = `scan_${timestamp}.tif`;
    link.href = url;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("파일 다운로드에 실패했습니다.");
  }
}

// ==========================================
// 7. 이벤트 리스너 연결
// ==========================================
if (startCaptureBtn) startCaptureBtn.addEventListener("click", startCamera);
if (closeCameraBtn) closeCameraBtn.addEventListener("click", closeCamera);
// ★ 촬영 버튼 이벤트를 onShutterBtnClick 으로 변경
if (shutterBtn) shutterBtn.addEventListener("click", onShutterBtnClick);
if (retakeBtn) retakeBtn.addEventListener("click", retakePhoto);
if (saveBtn) saveBtn.addEventListener("click", saveImage);
