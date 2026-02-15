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

// 상태 제어 변수
let stream = null;
let detectReq = null;
let isCapturing = false;
let stableCount = 0;
let lastGoodCoords = null; // 가장 최근에 찾은 마커 좌표

// ==========================================
// 2. 카메라 제어
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

    // 비디오 재생이 시작되면 실시간 마커 탐색 루프 실행
    isCapturing = false;
    stableCount = 0;
    detectReq = requestAnimationFrame(scanMarkersLoop);
  } catch (err) {
    alert("카메라 권한을 허용해주세요.");
    closeCamera();
  }
}

function closeCamera() {
  if (detectReq) cancelAnimationFrame(detectReq);
  isCapturing = true;

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  video.srcObject = null;
  cameraPage.style.display = "none";
  landingPage.style.display = "block";
  guideBox.classList.remove("detected");
}

// ==========================================
// 3. 실시간 마커 탐색 루프 (유예 시간 버퍼 적용)
// ==========================================
function scanMarkersLoop() {
  if (!stream || isCapturing) return;

  const vW = video.videoWidth;
  const vH = video.videoHeight;

  if (vW === 0) {
    detectReq = requestAnimationFrame(scanMarkersLoop);
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
  let thresh = new cv.Mat();
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();

  let foundMarkersThisFrame = false; // 이번 프레임에서 마커를 찾았는지 여부

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    cv.adaptiveThreshold(
      gray,
      thresh,
      255,
      cv.ADAPTIVE_THRESH_MEAN_C,
      cv.THRESH_BINARY_INV,
      41,
      10
    );
    cv.findContours(
      thresh,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE
    );

    let candidates = [];
    const minArea = dW * dH * 0.0001;
    const maxArea = dW * dH * 0.015; // QR코드는 무시하되, 마커 허용 범위를 살짝 넓힘 (1.5%)

    for (let i = 0; i < contours.size(); ++i) {
      let cnt = contours.get(i);
      let area = cv.contourArea(cnt);

      if (area > minArea && area < maxArea) {
        let rect = cv.boundingRect(cnt);
        let aspect = rect.width / rect.height;
        let extent = area / (rect.width * rect.height);

        // 속이 꽉 찬(55% 이상) 정사각형에 가까운 덩어리
        if (aspect >= 0.5 && aspect <= 2.0 && extent >= 0.55) {
          candidates.push({
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
          });
        }
      }
    }

    // 4개 이상의 점을 찾았을 때
    if (candidates.length >= 4) {
      candidates.sort((a, b) => a.x + a.y - (b.x + b.y));
      let tl = candidates[0];
      let br = candidates[candidates.length - 1];

      candidates.sort((a, b) => a.x - a.y - (b.x - b.y));
      let bl = candidates[0];
      let tr = candidates[candidates.length - 1];

      // 네 점의 거리가 충분히 떨어져 있는지 확인 (화면 노이즈 뭉침 방지)
      if (tr.x - tl.x > dW * 0.3) {
        foundMarkersThisFrame = true;
        lastGoodCoords = {
          tl: { x: tl.x / scale, y: tl.y / scale },
          tr: { x: tr.x / scale, y: tr.y / scale },
          br: { x: br.x / scale, y: br.y / scale },
          bl: { x: bl.x / scale, y: bl.y / scale },
        };
      }
    }

    // ==========================================
    // ★ 흔들림 방지(디바운싱) 및 자동 촬영 로직 ★
    // ==========================================
    if (typeof window.missedCount === "undefined") window.missedCount = 0;

    if (foundMarkersThisFrame) {
      stableCount++; // 성공 카운트 증가
      window.missedCount = 0; // 실패 카운트 초기화
      guideBox.classList.add("detected");

      // 약 15프레임(0.4~0.5초) 동안 찰나의 끊김 없이 유지되면 촬영!
      if (stableCount >= 15) {
        isCapturing = true;
        executeHighResCapture(lastGoodCoords);
        return; // 루프 완전 종료
      }
    } else {
      // 이번 프레임에서 마커를 놓쳤을 때
      window.missedCount++;

      // 5프레임(약 0.15초) 연속으로 놓쳤을 때만 완전 초기화!
      // (1~2프레임 놓친 건 봐줌)
      if (window.missedCount > 5) {
        stableCount = 0;
        guideBox.classList.remove("detected");
      }
    }
  } catch (err) {
    console.error("탐색 에러:", err);
  } finally {
    src.delete();
    gray.delete();
    thresh.delete();
    contours.delete();
    hierarchy.delete();
  }

  if (!isCapturing) detectReq = requestAnimationFrame(scanMarkersLoop);
}

function resetDetection() {
  stableCount = 0;
  lastGoodCoords = null;
  guideBox.classList.remove("detected");
}

// ==========================================
// 4. 고해상도 이미지 처리 (마커 기반)
// ==========================================
function executeHighResCapture(coords) {
  guideBox.classList.remove("detected");

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
    cv.adaptiveThreshold(
      dst,
      dst,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      21,
      15
    );

    cv.imshow(canvas, dst);
    scannedImage.src = canvas.toDataURL("image/jpeg", 0.9);

    // 화면 전환
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

// ==========================================
// 5. 수동 촬영 (수동 버튼 클릭 시 / 마커 못 찾았을 때 대비용)
// ==========================================
function manualFallbackCapture() {
  if (isCapturing) return;
  isCapturing = true; // 루프 정지

  // 만약 초록불이 뜬 상태에서 성급하게 버튼을 눌렀다면 자동 촬영 로직 강제 실행
  if (lastGoodCoords) {
    executeHighResCapture(lastGoodCoords);
    return;
  }

  // 마커를 아예 못 찾았는데 버튼을 누른 경우 -> 화면 중앙 가이드 박스 영역만 잘라냄
  const vW = video.videoWidth;
  const vH = video.videoHeight;
  canvas.width = vW;
  canvas.height = vH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, vW, vH);

  // CSS object-fit: cover 역계산
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
    // 화면에 보이는 중앙 박스를 기준으로 펴기
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
    cv.adaptiveThreshold(
      dst,
      dst,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      21,
      15
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
// 6. 결과 화면 동작
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

// 이벤트 리스너 연결
if (startCaptureBtn) startCaptureBtn.addEventListener("click", startCamera);
if (closeCameraBtn) closeCameraBtn.addEventListener("click", closeCamera);
if (shutterBtn) shutterBtn.addEventListener("click", manualFallbackCapture);
if (retakeBtn) retakeBtn.addEventListener("click", retakePhoto);
if (saveBtn) saveBtn.addEventListener("click", saveImage);
