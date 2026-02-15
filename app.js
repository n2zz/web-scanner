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
let stableCount = 0;
let lastGoodCoords = null;

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

    isCapturing = false;
    stableCount = 0;

    // 카메라가 켜지면 문서 탐색 루프 시작
    detectReq = requestAnimationFrame(scanDocumentLoop);
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
// 3. 실시간 문서 테두리 탐색 루프 (Edge Detection)
// ==========================================
function scanDocumentLoop() {
  if (!stream || isCapturing) return;

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
    // [1단계] 전처리 (흑백 -> 가우시안 블러 -> 외곽선 추출)
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
    cv.Canny(blurred, edges, 75, 200); // 캐니 엣지 검출기 적용 (선만 따냄)

    // [2단계] 윤곽선 찾기
    cv.findContours(
      edges,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE
    );

    let maxArea = 0;
    let bestPoints = null;

    // [3단계] 가장 큰 사각형(문서) 찾기
    for (let i = 0; i < contours.size(); ++i) {
      let cnt = contours.get(i);
      let area = cv.contourArea(cnt);

      // 화면의 최소 15% 이상을 차지하는 거대한 형태만 검사 (자잘한 노이즈 무시)
      if (area > dW * dH * 0.15) {
        let approx = new cv.Mat();
        let peri = cv.arcLength(cnt, true);

        // 선들을 부드럽게 이어서 다각형으로 근사화 (오차범위 2%)
        cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

        // 꼭짓점이 4개이고, 지금까지 찾은 것 중 가장 크다면 '문서'로 인정
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

    // [4단계] 문서를 찾았다면 4개의 꼭짓점 좌표 정렬
    if (bestPoints && bestPoints.length === 4) {
      bestPoints.sort((a, b) => a.x + a.y - (b.x + b.y));
      let tl = bestPoints[0];
      let br = bestPoints[3];

      bestPoints.sort((a, b) => a.x - a.y - (b.x - b.y));
      let bl = bestPoints[0];
      let tr = bestPoints[3];

      foundDocThisFrame = true;

      // 화면 스케일에 맞게 좌표 복원
      lastGoodCoords = {
        tl: { x: tl.x / scale, y: tl.y / scale },
        tr: { x: tr.x / scale, y: tr.y / scale },
        br: { x: br.x / scale, y: br.y / scale },
        bl: { x: bl.x / scale, y: bl.y / scale },
      };
    }

    // ==========================================
    // ★ 흔들림 방지(디바운싱) 및 자동 촬영 로직 ★
    // ==========================================
    if (typeof window.missedCount === "undefined") window.missedCount = 0;

    if (foundDocThisFrame) {
      stableCount++; // 성공 카운트 증가
      window.missedCount = 0; // 실패 카운트 초기화
      guideBox.classList.add("detected"); // 초록색 알림 켬

      // 약 15프레임(0.4~0.5초) 동안 유지되면 자동 촬영 발동!
      if (stableCount >= 15) {
        isCapturing = true;
        executeHighResCapture(lastGoodCoords);
        return; // 루프 완전 종료
      }
    } else {
      // 이번 프레임에서 문서를 놓쳤을 때
      window.missedCount++;

      // 5프레임(약 0.15초) 연속으로 놓쳤을 때만 완전 초기화
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
    blurred.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }

  if (!isCapturing) detectReq = requestAnimationFrame(scanDocumentLoop);
}

// ==========================================
// 4. 고해상도 이미지 평탄화 (Perspective Transform)
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
  let dsize = new cv.Size(1728, 2200); // 최종 해상도

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

    // 투영 변환 (사다리꼴 -> 직사각형 펴기)
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

    // 흑백 및 선명도(팩스) 처리
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
// 5. 수동 촬영 버튼 로직 (Fallback)
// ==========================================
function manualFallbackCapture() {
  if (isCapturing) return;
  isCapturing = true;

  // 초록불이 들어왔을 때 성급하게 누르면, 잡혀있는 문서 좌표로 바로 촬영
  if (lastGoodCoords && guideBox.classList.contains("detected")) {
    executeHighResCapture(lastGoodCoords);
    return;
  }

  // 아예 문서를 못 찾고 있는데 촬영 버튼을 누른 경우 -> 화면 중앙만 네모낳게 자르기
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

// 이벤트 리스너 연결
if (startCaptureBtn) startCaptureBtn.addEventListener("click", startCamera);
if (closeCameraBtn) closeCameraBtn.addEventListener("click", closeCamera);
if (shutterBtn) shutterBtn.addEventListener("click", manualFallbackCapture);
if (retakeBtn) retakeBtn.addEventListener("click", retakePhoto);
if (saveBtn) saveBtn.addEventListener("click", saveImage);
