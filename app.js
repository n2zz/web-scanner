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

// 5. 고해상도 처리: 테두리 기반 마커 탐색 및 평탄화 (Hybrid)
// ==========================================
function executeHighResCapture(coords) {
  guideBox.className = "camera-guide-box"; // UI 초기화

  const vW = video.videoWidth;
  const vH = video.videoHeight;
  canvas.width = vW;
  canvas.height = vH;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, vW, vH);

  let src = cv.imread(canvas);
  let gray = new cv.Mat();
  let thresh = new cv.Mat();
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();

  let dst = new cv.Mat();
  let dsize = new cv.Size(1728, 2200);

  try {
    // [1단계] 고해상도 원본에서 흑백 이진화로 까만 마커 덩어리들 찾기
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.adaptiveThreshold(
      gray,
      thresh,
      255,
      cv.ADAPTIVE_THRESH_MEAN_C,
      cv.THRESH_BINARY_INV,
      51,
      15
    );
    cv.findContours(
      thresh,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE
    );

    let candidates = [];
    const minArea = vW * vH * 0.00005; // 고해상도 기준 최소 크기
    const maxArea = vW * vH * 0.01;

    for (let i = 0; i < contours.size(); ++i) {
      let cnt = contours.get(i);
      let area = cv.contourArea(cnt);

      if (area > minArea && area < maxArea) {
        let rect = cv.boundingRect(cnt);
        let aspect = rect.width / rect.height;
        let extent = area / (rect.width * rect.height);

        // 정사각형에 가깝고 꽉 찬 도형만 후보에 올림
        if (aspect >= 0.5 && aspect <= 2.0 && extent >= 0.5) {
          candidates.push({
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
          });
        }
      }
    }

    // [2단계] 미리 찾았던 '종이 테두리 4점(coords)'과 가장 가까운 마커 4개 짝짓기
    if (candidates.length < 4) {
      throw new Error("마커개수부족");
    }

    const getDist = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
    let corners = [coords.tl, coords.tr, coords.br, coords.bl];
    let matchedMarkers = [];

    for (let corner of corners) {
      // 현재 꼭짓점과 가장 가까운 마커 찾기
      candidates.sort((a, b) => getDist(corner, a) - getDist(corner, b));
      let closest = candidates.shift(); // 찾은 건 목록에서 빼기

      // 만약 가장 가까운 마커가 꼭짓점에서 너무 멀면(예: 전체 화면 너비의 15% 밖) 엉뚱한 노이즈로 간주
      if (getDist(corner, closest) > vW * 0.15) {
        throw new Error("마커위치불량");
      }
      matchedMarkers.push(closest);
    }

    // [3단계] 찾은 4개의 마커를 기준으로 완벽한 시점 변환
    let mTL = matchedMarkers[0];
    let mTR = matchedMarkers[1];
    let mBR = matchedMarkers[2];
    let mBL = matchedMarkers[3];

    let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      mTL.x,
      mTL.y,
      mTR.x,
      mTR.y,
      mBR.x,
      mBR.y,
      mBL.x,
      mBL.y,
    ]);

    // 💡 튜닝 팁: 마커가 도화지 모서리에 딱 맞게 변환됩니다.
    // 만약 마커 바깥쪽의 하얀 여백도 스캔본에 남기고 싶다면 0 대신 숫자(예: 30)를 넣고, 넓이를 줄이세요.
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

    // [4단계] 팩스 효과 처리 (이전에 튜닝하신 51, 7 적용)
    cv.cvtColor(dst, dst, cv.COLOR_RGBA2GRAY, 0);
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

    // 정상 처리 후 화면 전환
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
    console.error("고해상도 처리 에러:", err.message);

    // ★ 마커를 찾지 못했을 때 얼럿 띄우고 다시 대기 상태로 복귀
    alert(
      "마커(■)가 가려졌거나 위치가 부정확합니다. 다시 촬영 버튼을 눌러주세요."
    );

    isCapturing = false;
    isScanningActive = false;
    guideBox.className = "camera-guide-box"; // UI 초기화

    // 셔터 버튼을 다시 보여줘서 재촬영 유도
    if (shutterBtn) shutterBtn.style.display = "block";
  } finally {
    src.delete();
    gray.delete();
    thresh.delete();
    contours.delete();
    hierarchy.delete();
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
