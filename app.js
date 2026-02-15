// ==========================================
// 1. DOM 요소 가져오기
// ==========================================
const landingPage = document.getElementById("landing-page");
const cameraPage = document.getElementById("camera-page");
const resultPage = document.getElementById("result-page");

const video = document.getElementById("video");
const canvas = document.getElementById("outputCanvas");
const scannedImage = document.getElementById("scannedImage");

const startCaptureBtn = document.getElementById("startCaptureBtn");
const shutterBtn = document.getElementById("shutterBtn");
const closeCameraBtn = document.getElementById("closeCameraBtn");
const retakeBtn = document.getElementById("retakeBtn");
const saveBtn = document.getElementById("saveBtn");

let stream = null;

// ==========================================
// 2. 카메라 제어 함수
// ==========================================
async function startCamera() {
  if (!window.isOpenCvReady) {
    alert("이미지 처리 엔진을 불러오는 중입니다. 잠시만 기다려주세요.");
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
  } catch (err) {
    console.error("카메라 오류:", err);
    alert("카메라 권한을 허용해주세요.");
    closeCamera();
  }
}

function closeCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  video.srcObject = null;

  cameraPage.style.display = "none";
  landingPage.style.display = "block";
}

// ==========================================
// 3. 마커 기반 문서 인식 및 스캔 변환 함수
// ==========================================
function takePhoto() {
  if (!stream) return;

  const vWidth = video.videoWidth;
  const vHeight = video.videoHeight;

  if (vWidth === 0 || vHeight === 0) return;

  canvas.width = vWidth;
  canvas.height = vHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, vWidth, vHeight);

  let src = cv.imread(canvas);
  let gray = new cv.Mat();
  let thresh = new cv.Mat();
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();

  try {
    // [1단계] 흑백 변환 및 이진화 (검은색 마커를 찾기 위해)
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);

    // 빛 반사 등을 고려한 적응형 이진화 적용 후 색상 반전 (검은색 -> 흰색 덩어리로 만듦)
    cv.adaptiveThreshold(
      gray,
      thresh,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      21,
      15
    );

    // [2단계] 윤곽선 찾기
    cv.findContours(
      thresh,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE
    );

    let candidates = [];

    // 화면 전체 크기 대비 마커의 예상 크기 범위 (환경에 따라 튜닝 가능)
    const minArea = vWidth * vHeight * 0.0001; // 너무 작은 노이즈 제거
    const maxArea = vWidth * vHeight * 0.05; // 너무 큰 영역 제거

    // [3단계] 검은색 정사각형 후보군 걸러내기
    for (let i = 0; i < contours.size(); ++i) {
      let cnt = contours.get(i);
      let area = cv.contourArea(cnt);

      if (area > minArea && area < maxArea) {
        let rect = cv.boundingRect(cnt);
        let aspectRatio = rect.width / rect.height;
        let extent = area / (rect.width * rect.height);

        // 조건: 가로세로 비율이 1에 가깝고(정사각형), 내부가 꽉 차있어야 함(extent > 0.7)
        if (aspectRatio >= 0.5 && aspectRatio <= 1.8 && extent >= 0.7) {
          // 정사각형의 중심점 계산
          let cx = rect.x + rect.width / 2;
          let cy = rect.y + rect.height / 2;
          candidates.push({ x: cx, y: cy });
        }
      }
    }

    // [4단계] 찾은 정사각형 중 가장 바깥쪽의 4개 점(네 귀퉁이) 추출
    if (candidates.length < 4) {
      alert(
        "용지의 네 귀퉁이 마커(■)를 찾을 수 없습니다.\n마커가 화면에 모두 들어오도록 잘 맞춰주세요."
      );
      return; // 카메라 화면 유지
    }

    // 좌표들을 이용해 좌상, 우하, 우상, 좌하 마커 찾기
    // x+y가 가장 작은 것이 좌상단, 가장 큰 것이 우하단
    candidates.sort((a, b) => a.x + a.y - (b.x + b.y));
    let tl = candidates[0];
    let br = candidates[candidates.length - 1];

    // x-y가 가장 큰 것이 우상단, 가장 작은 것이 좌하단
    candidates.sort((a, b) => a.x - a.y - (b.x - b.y));
    let bl = candidates[0];
    let tr = candidates[candidates.length - 1];

    // [5단계] 시점 변환 (4개의 마커 중심점을 기준으로 평탄화)
    let dst = new cv.Mat();
    let dsize = new cv.Size(1728, 2200); // 목표 해상도

    let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x,
      tl.y,
      tr.x,
      tr.y,
      br.x,
      br.y,
      bl.x,
      bl.y,
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

    // [6단계] 팩스 효과 (글자를 더 선명하게)
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

    // 결과 출력
    cv.imshow(canvas, dst);
    scannedImage.src = canvas.toDataURL("image/jpeg", 0.9);

    // 카메라 정지 및 화면 전환
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    cameraPage.style.display = "none";
    resultPage.style.display = "flex";

    // 메모리 해제
    dst.delete();
    srcTri.delete();
    dstTri.delete();
    M.delete();
  } catch (err) {
    console.error("이미지 처리 오류:", err);
    alert("이미지 처리 중 오류가 발생했습니다. 다시 촬영해주세요.");
  } finally {
    src.delete();
    gray.delete();
    thresh.delete();
    contours.delete();
    hierarchy.delete();
  }
}

// ==========================================
// 4. 결과 화면 동작 함수 (다시찍기, 저장)
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

    alert("다운로드가 완료되었습니다.");
  } catch (err) {
    console.error("TIF 변환/저장 오류:", err);
    alert("파일 다운로드에 실패했습니다.");
  }
}

// ==========================================
// 5. 이벤트 리스너 등록
// ==========================================
if (startCaptureBtn) startCaptureBtn.addEventListener("click", startCamera);
if (closeCameraBtn) closeCameraBtn.addEventListener("click", closeCamera);
if (shutterBtn) shutterBtn.addEventListener("click", takePhoto);
if (retakeBtn) retakeBtn.addEventListener("click", retakePhoto);
if (saveBtn) saveBtn.addEventListener("click", saveImage);
