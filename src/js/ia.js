// OkiroSport — Análisis IA (generado en el servidor, sin configurar nada)

async function genIA(tipo) {
  const ioEl  = document.getElementById('io');
  const bdEl  = document.getElementById('bd');
  const bs2El = document.getElementById('bs2');

  if (ioEl)  ioEl.textContent = 'Analizando tus datos...';
  if (bdEl)  bdEl.disabled  = true;
  if (bs2El) bs2El.disabled = true;

  try {
    const res = await api('/ia/resumen', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ tipo })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData?.error || `HTTP ${res.status}`);
    }

    const data  = await res.json();
    const texto = data?.texto || 'Sin respuesta';
    if (ioEl) typewriterEffect(ioEl, texto, 12);

  } catch (err) {
    if (ioEl) ioEl.textContent = `Error: ${err.message || err}`;
  } finally {
    if (bdEl)  bdEl.disabled  = false;
    if (bs2El) bs2El.disabled = false;
  }
}
