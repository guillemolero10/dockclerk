# SAM 3.1 en Modal (cuenta cajas y palés)

Servicio que habla el mismo contrato que `countLoad` (`src/lib/ai/vision.ts`). **Desplegado el 31/10** en el workspace `guillemolero10`. Si SAM no responde, `countLoad` usa Muse Spark (Baseten): 12 de 12 cajas y la dañada, ≈ 7-20 s, ≈ 0,5 céntimos.

## Cómo está protegido
`@modal.asgi_app(requires_proxy_auth=True)`: el borde de Modal rechaza con **401** cualquier petición sin un *proxy token* válido del workspace **antes** de arrancar el contenedor, así que nadie sin token enciende la GPU (comprobado: 0 contenedores tras peticiones sin y con token falso). La app manda `Authorization: Bearer <wk-...>.<ws-...>` (`SAM_API_KEY`). Si se filtra, se revoca con `modal workspace proxy-tokens delete` y se crea otro. La URL puede ser pública sin riesgo.

## Medidas (31/10, foto inventada de 12 cajas en un palé)
- Carga `sam3.1` (`/health`: `missing_weights: 4`, el hueco conocido del cuello); si faltara algo más, cae a `sam3`.
- 12 cajas, 1 palé; con `spotDamage`, dañada n.º 7. Resultado igual que con la CPU.
- Arranque en frío ≈ 25 s (pesos ya en el volumen); en caliente ≈ 1,3 s de ida y vuelta (0,3 s dentro).
- L4 no tenía capacidad en la primera prueba, por eso `gpu=["L4", "A10", "L40S"]` (la primera libre). Coste: unos 0,001 $ por foto en caliente, ≈ 0,02 $ un arranque; `scaledown_window=60`, `max_containers=1`.
- Peticiones que tarden más de 150 s devuelven un 303 (Modal): `fetch` lo sigue solo.

## Pasos (ya hechos; para repetir en otro workspace)
1. Acceso a `facebook/sam3.1` y `facebook/sam3` en Hugging Face y secreto `dockclerk-hf` (`modal secret create dockclerk-hf HF_TOKEN=...`).
2. `modal workspace proxy-tokens create --name dockclerk-app --json` → guardar `Authorization` (sin el prefijo `Bearer `) como `SAM_API_KEY`. El secreto solo se ve al crearlo.
3. Desde `dockclerk/`: `modal deploy modal/sam_service.py` → imprime la URL → `META_SAM_URL`.
4. `curl -L -H "Authorization: Bearer $SAM_API_KEY" $META_SAM_URL/health` → modelo y pesos que faltan. Sin cabecera debe dar 401.
5. `npx tsx --env-file=.env scripts/sam-check.ts foto.jpg` (la primera llamada incluye el arranque en frío).
6. `SAM_API_KEY` y `META_SAM_URL` en Vercel. Antes de grabar, hacer una llamada para calentarlo.

Parar todo: `modal app stop dockclerk-sam`. Código de Meta: <https://github.com/facebookresearch/sam3>.
