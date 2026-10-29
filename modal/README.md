# SAM 3.1 en Modal (cuenta cajas y palés)

Servicio que habla el mismo contrato que `countLoad` (`src/lib/ai/vision.ts`). **No está desplegado**: sigue estos pasos.

Código de Meta: <https://github.com/facebookresearch/sam3>. Cajas del modelo: xyxy en píxeles; el servicio las pasa a xywh 0..1.

## Pasos
1. En <https://huggingface.co/facebook/sam3.1> pulsa «Agree / Request access». Pide también `facebook/sam3` (plan B del servicio si el checkpoint 3.1 no sirve para imagen).
2. En Hugging Face > Settings > Access Tokens crea un token de **lectura**.
3. `modal token new` (abre el navegador; workspace `guillemolero10`).
4. Crea los secretos (pon tú los valores; el de SAM es una cadena larga aleatoria, p. ej. `openssl rand -hex 32`):
   ```
   modal secret create dockclerk-sam SAM_TOKEN=<cadena-aleatoria>
   modal secret create dockclerk-hf HF_TOKEN=<token-de-hf>
   ```
5. Desde `dockclerk/`: `modal deploy modal/sam_service.py`. Imprime la URL (algo como `https://guillemolero10--dockclerk-sam-sam-web.modal.run`).
6. En `.env` y en Vercel (Settings > Environment Variables):
   - `META_SAM_URL` = esa URL
   - `SAM_API_KEY` = el mismo valor que `SAM_TOKEN`
7. Prueba con una foto inventada: `npx tsx --env-file=.env scripts/sam-check.ts foto.jpg`. La primera llamada incluye el arranque en frío; la segunda mide el tiempo real. Comprueba a ojo que las cajas sean razonables.
8. Mira en `https://guillemolero10--dockclerk-sam-sam-web.modal.run/health` (con `Authorization: Bearer <token>`) si cargó `sam3.1` o `sam3` (plan B).

## Coste (L4 ≈ 0,8 $/h en Modal, cobrado por segundo; comprobar en modal.com/pricing)
- Una foto en caliente: ~1-3 s de GPU, menos de 0,001 $.
- Arranque en frío (imagen + pesos del volumen): ~30-90 s la primera vez tras estar parado; la primera descarga de pesos, más. Equivale a ~0,02 $.
- `scaledown_window=60`: la GPU se apaga 1 min tras la última foto. Una sesión de pruebas de una hora con la GPU siempre viva sería ~0,8 $. Con 100 $ de créditos sobra de largo.
- Antes de grabar el vídeo, haz una llamada para calentarlo.

## Si algo falla
- `401`: el token no coincide con `SAM_TOKEN`. `413/422`: foto de más de 8 MB, más de 5 prompts o texto largo.
- Si la app no consigue respuesta en 60 s, `countLoad` usa Muse Spark visión (plan B ya hecho).
- Para parar todo: `modal app stop dockclerk-sam`.
