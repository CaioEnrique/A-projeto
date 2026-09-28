/* ============================================================
   RADAR INTELIGENTE - Web Serial API
   (tudo em km/h: cards, grafico, eixo, alerta)
   ============================================================ */

// ==================== ESTADO GLOBAL ====================
let port = null;
let reader = null;
let keepReading = true;

let historico = [];
let velocidadeMaxima = 0;       // em km/h
let velocidadeMaximaKmh = 0;    // em km/h (mesma coisa, mas mantenho por compatibilidade)
let somaVelocidades = 0;        // em km/h

// Ajuste se quiser o alerta de excesso de velocidade
const LIMITE_VELOCIDADE_KMH   = 45.0;   // km/h (equivale a ~12.5 m/s)
const MAX_VELOCIDADE_GRAFICO  = 70.0;   // km/h (escala do grafico)

// ==================== ELEMENTOS DOM ====================
const connectBtn   = document.getElementById('connectBtn');
const statusDot    = document.getElementById('statusDot');
const statusText   = document.getElementById('statusText');
const currentSpeed = document.getElementById('currentSpeed'); // km/h (destaque)
const currentKmh   = document.getElementById('currentKmh');   // m/s (secundario)
const recordSpeed  = document.getElementById('recordSpeed');  // km/h (destaque)
const recordKmh    = document.getElementById('recordKmh');    // m/s (secundario)
const counterEl    = document.getElementById('counter');
const avgSpeed     = document.getElementById('avgSpeed');     // km/h (destaque)
const avgKmh       = document.getElementById('avgKmh');       // m/s (secundario)
const speedBarFill = document.getElementById('speedBarFill');
const alertBox     = document.getElementById('alertBox');
const historyBody  = document.getElementById('historyBody');
const historyCount = document.getElementById('historyCount');
const clearBtn     = document.getElementById('clearBtn');
const canvas       = document.getElementById('speedChart');
const ctx          = canvas.getContext('2d');

// ==================== VERIFICACAO DE SUPORTE ====================
if (!('serial' in navigator)) {
  connectBtn.disabled = true;
  connectBtn.textContent = '❌ Navegador sem suporte';
  statusText.textContent = 'Use Chrome ou Edge';
}

// ==================== CONECTAR / DESCONECTAR ====================
connectBtn.addEventListener('click', async () => {
  if (port) {
    await desconectar();
  } else {
    await conectar();
  }
});

async function conectar() {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });

    statusDot.classList.remove('offline');
    statusDot.classList.add('online');
    statusText.textContent = 'Conectado';
    connectBtn.textContent = '🔌 Desconectar';
    connectBtn.classList.add('connected');

    keepReading = true;
    lerSerial();

    console.log('✅ Conectado ao Arduino');
  } catch (err) {
    console.error('Erro ao conectar:', err);
    statusText.textContent = 'Falha na conexão';
  }
}

async function desconectar() {
  keepReading = false;

  try {
    if (reader) {
      await reader.cancel();
      reader = null;
    }
    if (port) {
      await port.close();
      port = null;
    }
  } catch (err) {
    console.error('Erro ao desconectar:', err);
  }

  statusDot.classList.remove('online');
  statusDot.classList.add('offline');
  statusText.textContent = 'Desconectado';
  connectBtn.textContent = '🔌 Conectar Arduino';
  connectBtn.classList.remove('connected');
}

// ==================== LEITURA SERIAL ====================
async function lerSerial() {
  const textDecoder = new TextDecoderStream();
  const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
  reader = textDecoder.readable.getReader();

  let buffer = '';

  try {
    while (keepReading) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += value;

      let linhas = buffer.split('\n');
      buffer = linhas.pop();

      for (const linha of linhas) {
        processarLinha(linha.trim());
      }
    }
  } catch (err) {
    if (keepReading) console.error('Erro na leitura:', err);
  } finally {
    reader.releaseLock();
  }
}

// ==================== PROCESSAR LINHA RECEBIDA ====================
function processarLinha(linha) {
  if (!linha) return;

  // Formato do Arduino: s=0.0140  m/s=10.71  km/h=38.57
  const match = linha.match(/s=([\d.]+)\s+m\/s=([\d.]+)\s+km\/h=([\d.]+)/);

  if (!match) {
    console.log('Linha ignorada:', linha);
    return;
  }

  const tempoS        = parseFloat(match[1]);
  const velocidadeMs  = parseFloat(match[2]);
  const velocidadeKmh = parseFloat(match[3]);

  adicionarMedicao(tempoS, velocidadeMs, velocidadeKmh);
}

// ==================== ADICIONAR MEDICAO ====================
function adicionarMedicao(tempoS, velocidadeMs, velocidadeKmh) {
  const medicao = {
    id: historico.length + 1,
    tempoS: tempoS,
    velocidadeMs: velocidadeMs,
    velocidadeKmh: velocidadeKmh,
    distancia: 0.15,
    hora: new Date().toLocaleTimeString('pt-BR')
  };

  historico.push(medicao);
  somaVelocidades += velocidadeKmh;   // agora soma em km/h

  if (velocidadeKmh > velocidadeMaxima) {
    velocidadeMaxima = velocidadeKmh;
    velocidadeMaximaKmh = velocidadeKmh;
  }

  // ---- Atualiza cards ----
  currentSpeed.textContent = velocidadeKmh.toFixed(1);                              // km/h (destaque)
  currentKmh.textContent   = velocidadeMs.toFixed(1);                               // m/s (secundario)
  recordSpeed.textContent  = velocidadeMaximaKmh.toFixed(1);                        // km/h
  recordKmh.textContent    = (velocidadeMaximaKmh / 3.6).toFixed(1);                // m/s
  counterEl.textContent    = historico.length;
  avgSpeed.textContent     = (somaVelocidades / historico.length).toFixed(1);       // km/h
  avgKmh.textContent       = ((somaVelocidades / historico.length) / 3.6).toFixed(1); // m/s

  // ---- Barra de velocidade (agora em km/h) ----
  const pct = Math.min((velocidadeKmh / MAX_VELOCIDADE_GRAFICO) * 100, 100);
  speedBarFill.style.width = pct + '%';

  // ---- Alerta (agora em km/h) ----
  if (velocidadeKmh >= LIMITE_VELOCIDADE_KMH) {
    alertBox.classList.remove('hidden');
    setTimeout(() => alertBox.classList.add('hidden'), 3000);
  }

  // ---- Tabela ----
  adicionarLinhaTabela(medicao);

  // ---- Grafico ----
  desenharGrafico();

  // ---- Contador ----
  historyCount.textContent = historico.length + ' registros';
}

// ==================== TABELA ====================
function adicionarLinhaTabela(m) {
  const emptyRow = historyBody.querySelector('.empty-row');
  if (emptyRow) emptyRow.remove();

  const tr = document.createElement('tr');
  tr.className = 'new-row';

  // Cores de acordo com a velocidade em km/h
  let classeVel = 'speed-slow';
  if (m.velocidadeKmh >= 55) classeVel = 'speed-fast';
  else if (m.velocidadeKmh >= 30) classeVel = 'speed-mid';

  tr.innerHTML = `
    <td>#${String(m.id).padStart(3, '0')}</td>
    <td class="${classeVel}">${m.velocidadeKmh.toFixed(2)}</td>
    <td>${m.velocidadeMs.toFixed(2)}</td>
    <td>${m.tempoS.toFixed(4)}</td>
    <td>${m.distancia.toFixed(3)}</td>
    <td>${m.hora}</td>
  `;

  historyBody.insertBefore(tr, historyBody.firstChild);
}

// ==================== GRAFICO (agora em km/h) ====================
function desenharGrafico() {
  const W = canvas.width;
  const H = canvas.height;
  const pad = { top: 20, right: 20, bottom: 30, left: 55 };

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0a0d12';
  ctx.fillRect(0, 0, W, H);

  const areaW = W - pad.left - pad.right;
  const areaH = H - pad.top - pad.bottom;

  // ---- Grid horizontal ----
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 1;
  ctx.font = '11px monospace';
  ctx.fillStyle = '#8b949e';
  ctx.textAlign = 'right';

  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (areaH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();

    const valor = MAX_VELOCIDADE_GRAFICO * (1 - i / 4);
    ctx.fillText(valor.toFixed(0) + ' km/h', pad.left - 6, y + 4);
  }

  if (historico.length === 0) {
    ctx.fillStyle = '#8b949e';
    ctx.textAlign = 'center';
    ctx.font = '14px sans-serif';
    ctx.fillText('Aguardando medições...', W / 2, H / 2);
    return;
  }

  const dados = historico.slice(-50);
  const passo = dados.length > 1 ? areaW / (dados.length - 1) : 0;

  const pontos = dados.map((m, i) => ({
    x: pad.left + i * passo,
    y: pad.top + areaH - (Math.min(m.velocidadeKmh, MAX_VELOCIDADE_GRAFICO) / MAX_VELOCIDADE_GRAFICO) * areaH,
    v: m.velocidadeKmh
  }));

  // ---- Area preenchida ----
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + areaH);
  grad.addColorStop(0, 'rgba(255, 43, 43, 0.35)');
  grad.addColorStop(1, 'rgba(255, 43, 43, 0)');

  ctx.beginPath();
  ctx.moveTo(pontos[0].x, pad.top + areaH);
  for (const p of pontos) ctx.lineTo(p.x, p.y);
  ctx.lineTo(pontos[pontos.length - 1].x, pad.top + areaH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // ---- Linha ----
  ctx.beginPath();
  ctx.strokeStyle = '#ff2b2b';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';

  pontos.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();

  // ---- Pontos ----
  for (const p of pontos) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffcc00';
    ctx.fill();
  }

  // ---- Ultimo valor em destaque ----
  const ultimo = pontos[pontos.length - 1];
  ctx.beginPath();
  ctx.arc(ultimo.x, ultimo.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 204, 0, 0.25)';
  ctx.fill();
}

// ==================== LIMPAR ====================
clearBtn.addEventListener('click', () => {
  if (historico.length === 0) return;

  if (!confirm('Apagar todo o histórico de medições?')) return;

  historico = [];
  velocidadeMaxima = 0;
  velocidadeMaximaKmh = 0;
  somaVelocidades = 0;

  currentSpeed.textContent = '0.0';
  currentKmh.textContent   = '0.0';
  recordSpeed.textContent  = '0.0';
  recordKmh.textContent    = '0.0';
  counterEl.textContent    = '0';
  avgSpeed.textContent     = '0.0';
  avgKmh.textContent       = '0.0';
  speedBarFill.style.width = '0%';

  historyBody.innerHTML = `
    <tr class="empty-row">
      <td colspan="6">Nenhuma medição ainda. Conecte o Arduino e passe um carrinho!</td>
    </tr>
  `;
  historyCount.textContent = '0 registros';

  desenharGrafico();
});

// ==================== INICIAL ====================
desenharGrafico();
