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
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    cv.adaptiveThreshold(
      gray,
      thresh,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      21,
      15
    );

    cv.findContours(
      thresh,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL,
      cv.CHAIN_APPROX_SIMPLE
    );

    let candidates = [];

    const minArea = vWidth * vHeight * 0.0001;
    const maxArea = vWidth * vHeight * 0.05;

    for (let i = 0; i < contours.size(); ++i) {
      let cnt = contours.get(i);
      let area = cv.contourArea(cnt);

      if (area > minArea && area < maxArea) {
        let rect = cv.boundingRect(cnt);
        let aspectRatio = rect.width / rect.height;
        let extent = area / (rect.width * rect.height);

        if (aspectRatio >= 0.5 && aspectRatio <= 1.8 && extent >= 0.7) {
          let cx = rect.x + rect.width / 2;
          let cy = rect.y + rect.height / 2;
          candidates.push({ x: cx, y: cy });
        }
      }
    }

    // ★ 수정된 부분: 마커를 찾지 못했을 때 얼럿 후 비디오 다시 재생 ★
    if (candidates.length < 4) {
      alert(
        "용지의 네 귀퉁이 마커(■)를 찾을 수 없습니다.\n마커가 화면에 모두 들어오도록 잘 맞춰주세요."
      );

      // 경고창 때문에 멈춘 카메라 화면을 다시 강제 재생
      if (video.paused) {
        video.play();
      }
      return;
    }

    candidates.sort((a, b) => a.x + a.y - (b.x + b.y));
    let tl = candidates[0];
    let br = candidates[candidates.length - 1];

    candidates.sort((a, b) => a.x - a.y - (b.x - b.y));
    let bl = candidates[0];
    let tr = candidates[candidates.length - 1];

    let dst = new cv.Mat();
    let dsize = new cv.Size(1728, 2200);

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

    dst.delete();
    srcTri.delete();
    dstTri.delete();
    M.delete();
  } catch (err) {
    console.error("이미지 처리 오류:", err);
    alert("이미지 처리 중 오류가 발생했습니다. 다시 촬영해주세요.");

    // ★ 수정된 부분: 에러 얼럿 후에도 비디오 다시 재생 ★
    if (video.paused) {
      video.play();
    }
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
