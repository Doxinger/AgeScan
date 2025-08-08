// Фото не передается никуда и не сохраняется. Вся обработка — в браузере.
document.addEventListener('DOMContentLoaded', () => {
  const $jq = window.jQuery;

  const REMOTE_MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
  const LOCAL_MODEL_URL = './models';

  let modelsLoaded = false;
  let useLocal = false;
  let radarChart = null;
  let imageObjectURL = null;

  const els = {
    useLocalModels: document.getElementById('useLocalModels'),
    modelStatus: document.getElementById('modelStatus'),
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    analyzeBtn: document.getElementById('analyzeBtn'),
    clearBtn: document.getElementById('clearBtn'),
    previewImg: document.getElementById('previewImg'),
    overlay: document.getElementById('overlay'),
    palette: document.getElementById('palette'),
    ageVal: document.getElementById('ageVal'),
    genderVal: document.getElementById('genderVal'),
    genderConf: document.getElementById('genderConf'),
    metricsList: document.getElementById('metricsList'),
    radarCanvas: document.getElementById('radarChart')
  };

  // Эвристические базовые линии для "уникальности"
  const baselines = {
    eyeDistRatio: { mu: 0.46, sigma: 0.05, label: 'Глаза/ширина лица' },
    mouthWidthRatio: { mu: 0.38, sigma: 0.06, label: 'Рот/ширина лица' },
    noseLengthRatio: { mu: 0.35, sigma: 0.05, label: 'Нос/высота лица' },
    symmetryScore: { mu: 0.90, sigma: 0.05, label: 'Симметрия (0–1)' },
    jawAngleDeg: { mu: 130, sigma: 10, label: 'Угол челюсти (°)' }
  };

  init();

  async function init() {
    bindUI();
    await loadModels();
  }

  function bindUI() {
    // Переключатель источника моделей
    els.useLocalModels.addEventListener('change', async (e) => {
      useLocal = e.target.checked;
      modelsLoaded = false;
      updateModelStatus('Перезагрузка моделей…');
      try {
        await loadModels();
      } catch (err) {
        updateModelStatus('Ошибка загрузки моделей. Проверьте папку ./models или интернет.', true);
        console.error(err);
      }
    });

    // Зона перетаскивания
    els.dropzone.addEventListener('click', () => els.fileInput.click());
    els.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      els.dropzone.classList.add('dragover');
    });
    els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('dragover'));
    els.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      els.dropzone.classList.remove('dragover');
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    });

    els.fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    });

    els.analyzeBtn.addEventListener('click', () => analyzeImage());
    els.clearBtn.addEventListener('click', () => clearAll());
  }

  async function loadModels() {
    const base = useLocal ? LOCAL_MODEL_URL : REMOTE_MODEL_URL;
    updateModelStatus(`Загрузка моделей из: ${useLocal ? 'локально' : 'сети'}…`);
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(base),
      faceapi.nets.faceLandmark68Net.loadFromUri(base),
      faceapi.nets.faceRecognitionNet.loadFromUri(base),
      faceapi.nets.ageGenderNet.loadFromUri(base)
    ]);
    modelsLoaded = true;
    updateModelStatus(`Модели загружены (${useLocal ? 'локально' : 'из сети'}) ✔`);
  }

  function updateModelStatus(text, isError = false) {
    els.modelStatus.textContent = text;
    els.modelStatus.style.color = isError ? '#ff9a9a' : '';
  }

  function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;

    // Чистим предыдущие ObjectURL
    if (imageObjectURL) {
      URL.revokeObjectURL(imageObjectURL);
      imageObjectURL = null;
    }

    imageObjectURL = URL.createObjectURL(file);
    els.previewImg.src = imageObjectURL;
    els.previewImg.onload = () => {
      // Подгоняем canvas
      const { width, height } = els.previewImg.getBoundingClientRect();
      els.overlay.width = Math.round(els.previewImg.naturalWidth);
      els.overlay.height = Math.round(els.previewImg.naturalHeight);
      // Визуально растянется вместе с img (CSS width:100%)
      els.analyzeBtn.disabled = false;
      els.clearBtn.disabled = false;

      // Показ палитры
      renderPalette(els.previewImg);
    };
  }

  function clearAll() {
    // Не сохраняем и не отправляем — просто очищаем из памяти
    if (imageObjectURL) {
      URL.revokeObjectURL(imageObjectURL);
      imageObjectURL = null;
    }
    els.fileInput.value = '';
    els.previewImg.removeAttribute('src');
    const ctx = els.overlay.getContext('2d');
    ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);
    els.palette.innerHTML = '';
    els.ageVal.textContent = '—';
    els.genderVal.textContent = '—';
    els.genderConf.textContent = '';
    els.metricsList.innerHTML = '';
    if (radarChart) {
      radarChart.destroy();
      radarChart = null;
    }
    els.analyzeBtn.disabled = true;
    els.clearBtn.disabled = true;
  }

  async function analyzeImage() {
    if (!modelsLoaded) {
      updateModelStatus('Модели еще загружаются…', true);
      return;
    }
    if (!els.previewImg.src) return;

    // Настройки детектора
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 416,
      scoreThreshold: 0.5
    });

    // Детекция
    const detection = await faceapi
      .detectSingleFace(els.previewImg, options)
      .withFaceLandmarks()
      .withFaceDescriptor()
      .withAgeAndGender();

    const ctx = els.overlay.getContext('2d');
    ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);

    if (!detection) {
      toast('Лицо не найдено. Попробуйте фото с фронтальным лицом и хорошим светом.');
      return;
    }

    // Отрисовка рамки и лэндмарков
    faceapi.matchDimensions(els.overlay, { width: els.previewImg.naturalWidth, height: els.previewImg.naturalHeight });
    const resizedDet = faceapi.resizeResults(detection, { width: els.previewImg.naturalWidth, height: els.previewImg.naturalHeight });
    drawDetections(resizedDet);

    // Возраст/пол
    const age = Math.round(resizedDet.age);
    const gender = resizedDet.gender; // 'male'/'female'
    const conf = resizedDet.genderProbability || 0;
    els.ageVal.textContent = `${age} лет (± несколько лет)`;
    els.genderVal.textContent = gender === 'male' ? 'мужской' : 'женский';
    els.genderConf.textContent = `(${(conf * 100).toFixed(0)}% уверенность)`;

    // Метрики
    const metrics = computeMetrics(resizedDet);
    renderMetrics(metrics);
    renderRadar(metrics);
  }

  function drawDetections(res) {
    const ctx = els.overlay.getContext('2d');
    const { box } = res.detection;
    ctx.save();
    // Рамка
    ctx.strokeStyle = '#5ad1e6';
    ctx.lineWidth = 2;
    roundRect(ctx, box.x, box.y, box.width, box.height, 10);
    ctx.stroke();

    // Лэндмарки
    ctx.fillStyle = '#8e7dff';
    ctx.globalAlpha = 0.8;
    const pts = res.landmarks.positions;
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function computeMetrics(res) {
    const lm = res.landmarks;
    const pts = lm.positions;

    // Утилиты
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const avgPt = (arr) => arr.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 })
                             && { x: arr.reduce((s, p) => s + p.x, 0) / arr.length, y: arr.reduce((s, p) => s + p.y, 0) / arr.length };
    const angleDeg = (a, o, b) => {
      const v1 = { x: a.x - o.x, y: a.y - o.y };
      const v2 = { x: b.x - o.x, y: b.y - o.y };
      const dot = v1.x * v2.x + v1.y * v2.y;
      const m1 = Math.hypot(v1.x, v1.y);
      const m2 = Math.hypot(v2.x, v2.y);
      const cos = Math.min(1, Math.max(-1, dot / (m1 * m2)));
      return (Math.acos(cos) * 180) / Math.PI;
    };

    const leftEye = lm.getLeftEye();
    const rightEye = lm.getRightEye();
    const mouth = lm.getMouth();
    const jaw = lm.getJawOutline(); // 17 точек (0..16)
    const nose = lm.getNose();

    const leftEyeCenter = avgPt(leftEye);
    const rightEyeCenter = avgPt(rightEye);
    const eyeDist = dist(leftEyeCenter, rightEyeCenter);

    const faceWidth = dist(jaw[4], jaw[12]); // уши-скулы
    const faceHeight = res.detection.box.height;

    const mouthWidth = dist(mouth[0], mouth[6]); // 48..54 -> 0..6 в массиве mouth
    const noseLength = dist(nose[0], nose[6] || nose[nose.length - 1]); // примерно верх-низ

    // Симметрия: сравнение пар челюсти по разные стороны от центра
    const midX = (leftEyeCenter.x + rightEyeCenter.x) / 2;
    let symAccum = 0;
    let symN = 0;
    for (let i = 0; i <= 8; i++) {
      const L = jaw[i];              // слева
      const R = jaw[16 - i];         // справа
      const Lm = { x: 2 * midX - L.x, y: L.y }; // зеркальная точка L
      const d = dist(Lm, R);
      const norm = faceWidth || 1;
      symAccum += 1 - Math.min(1, d / (norm * 0.5)); // 1 = идеально
      symN++;
    }
    const symmetryScore = symN ? symAccum / symN : 0.9;

    // Угол челюсти: угол в точке подбородка между скуловыми точками
    const jawAngle = angleDeg(jaw[4], jaw[8], jaw[12]); // меньше = "острее" подбородок

    // Относительные пропорции
    const eyeDistRatio = eyeDist / (faceWidth || 1);
    const mouthWidthRatio = mouthWidth / (faceWidth || 1);
    const noseLengthRatio = noseLength / (faceHeight || 1);

    return {
      eyeDistRatio,
      mouthWidthRatio,
      noseLengthRatio,
      symmetryScore: clamp(symmetryScore, 0, 1),
      jawAngleDeg: jawAngle
    };
  }

  function renderMetrics(metrics) {
    els.metricsList.innerHTML = '';
    const defs = [
      { key: 'eyeDistRatio', fmt: (v) => v.toFixed(3) },
      { key: 'mouthWidthRatio', fmt: (v) => v.toFixed(3) },
      { key: 'noseLengthRatio', fmt: (v) => v.toFixed(3) },
      { key: 'symmetryScore', fmt: (v) => v.toFixed(3) },
      { key: 'jawAngleDeg', fmt: (v) => `${v.toFixed(1)}°` }
    ];

    for (const d of defs) {
      const v = metrics[d.key];
      const base = baselines[d.key];
      const uniq = uniquenessScore(v, base.mu, base.sigma);
      const li = document.createElement('li');

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = `${base.label}`;

      const val = document.createElement('span');
      val.className = 'val' + (uniq >= 66 ? ' warn' : '');
      val.textContent = `${d.fmt(v)} · уникальность ${Math.round(uniq)}%`;

      li.appendChild(name);
      li.appendChild(val);
      els.metricsList.appendChild(li);
    }
  }

  function renderRadar(metrics) {
    const labels = [
      baselines.eyeDistRatio.label,
      baselines.mouthWidthRatio.label,
      baselines.noseLengthRatio.label,
      baselines.symmetryScore.label,
      baselines.jawAngleDeg.label
    ];
    const data = [
      uniquenessScore(metrics.eyeDistRatio, baselines.eyeDistRatio.mu, baselines.eyeDistRatio.sigma),
      uniquenessScore(metrics.mouthWidthRatio, baselines.mouthWidthRatio.mu, baselines.mouthWidthRatio.sigma),
      uniquenessScore(metrics.noseLengthRatio, baselines.noseLengthRatio.mu, baselines.noseLengthRatio.sigma),
      uniquenessScore(metrics.symmetryScore, baselines.symmetryScore.mu, baselines.symmetryScore.sigma),
      uniquenessScore(metrics.jawAngleDeg, baselines.jawAngleDeg.mu, baselines.jawAngleDeg.sigma)
    ].map(x => Math.round(x));

    if (radarChart) radarChart.destroy();
    radarChart = new Chart(els.radarCanvas.getContext('2d'), {
      type: 'radar',
      data: {
        labels,
        datasets: [{
          label: 'Уникальность (0–100)',
          data,
          pointRadius: 3,
          borderColor: '#5ad1e6',
          backgroundColor: 'rgba(90, 209, 230, 0.15)'
        }]
      },
      options: {
        responsive: true,
        scales: {
          r: {
            beginAtZero: true,
            suggestedMax: 100,
            ticks: { stepSize: 20, color: '#9aa0bf' },
            grid: { color: 'rgba(154,160,191,0.25)' },
            angleLines: { color: 'rgba(154,160,191,0.25)' },
            pointLabels: { color: '#cfd3ec', font: { size: 12 } }
          }
        },
        plugins: {
          legend: { labels: { color: '#cfd3ec' } }
        }
      }
    });
  }

  function uniquenessScore(value, mu, sigma) {
    // Z-score по модулю и сглаженный маппинг в 0..100
    if (!isFinite(value)) return 0;
    const z = Math.abs((value - mu) / (sigma || 1e-6));
    // Сгладим через tanh, затем в проценты:
    const s = Math.tanh(z); // 0..~1
    return clamp(s * 100, 0, 100);
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function toast(text) {
    // Простейший тост
    updateModelStatus(text, true);
    setTimeout(() => updateModelStatus(modelsLoaded ? 'Модели загружены ✔' : 'Модели: не загружены'), 3000);
  }

  function renderPalette(imgEl) {
    els.palette.innerHTML = '';
    try {
      const ct = new window.ColorThief();
      // Если изображение слишком большое, ColorThief всё равно возьмет подвыборку
      const palette = ct.getPalette(imgEl, 6) || [];
      for (const rgb of palette) {
        const [r, g, b] = rgb;
        const sw = document.createElement('div');
        sw.className = 'swatch';
        sw.title = `rgb(${r}, ${g}, ${b})`;
        sw.style.background = `rgb(${r}, ${g}, ${b})`;
        els.palette.appendChild(sw);
      }
    } catch (e) {
      // На случай, если браузер ругнётся на CORS (обычно с локальным файлом всё ок)
      console.warn('Palette error:', e);
    }
  }
});
