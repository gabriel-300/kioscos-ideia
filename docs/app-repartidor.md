# App Android "Angiru Reparto"

App solo para repartidores. Sirve para una cosa: que **la ubicación se siga enviando al cliente con el celular bloqueado
o con otra aplicación abierta** (una web no puede; ver `docs/requirements.md`, "Ubicación en vivo del repartidor").

## Cómo está hecha

- Carpeta `app-repartidor/`: proyecto Capacitor 8 con su propio `package.json` (no toca las dependencias de la web; el
  `tsconfig` y el `eslint` de la raíz la excluyen y `vitest` solo mira `tests/unit`).
- Es una **cáscara**: `capacitor.config.json` apunta `server.url` a `https://kioscos-ideia.lytwyn-ideia.workers.dev/tenteo/repartos`, con
  `allowNavigation` limitado a `kioscos-ideia.lytwyn-ideia.workers.dev`. Apunta a la dirección del personal (workers.dev) y no a www.angirufood.com.ar, porque en el dominio de los clientes el login y los paneles dan 404 (decisión de seguridad del 26/10/2026). Siempre muestra la versión actual de la web: **cambios en la web no
  exigen reinstalar la app**. El repartidor inicia sesión dentro de la app (la cookie de sesión persiste).
  Sin internet muestra `www/error.html` ("No hay conexión").
- Datos: `appId` `ar.com.angirufood.reparto`, nombre "Angiru Reparto", orientación vertical, ícono y pantalla de inicio
  con la "A" de la tienda (`app-repartidor/assets/`, generados con `@capacitor/assets`: `npm run assets` dentro de la carpeta).
- Ubicación: plugin `@capacitor-community/background-geolocation` (servicio en primer plano de tipo `location` con la
  notificación fija "Compartiendo tu ubicación con el cliente"). Permisos declarados en `AndroidManifest.xml`: ubicación
  precisa y aproximada, ubicación en segundo plano, servicio en primer plano + su tipo ubicación, notificaciones, wake lock.
  `MainActivity.java` pide el permiso de notificaciones (Android 13+) al abrir, porque el plugin no lo pide.
- Web: `src/components/tenteo/compartir-ubicacion.tsx` detecta la app con `window.Capacitor.isNativePlatform()` y toma el
  plugin del puente global (`window.Capacitor.Plugins` / `registerPlugin`); **no se importa ningún paquete de Capacitor en la
  web**. En la app usa el plugin; en un navegador común queda igual que antes (`navigator.geolocation` + Wake Lock).
  Cada punto se manda con la misma Server Action (`enviarPosicionRepartidor`), como máximo uno cada `INTERVALO_ENVIO_MS`
  (12 s). Al tocar "Dejar de compartir", al entregar el último pedido o al salir de la pantalla se llama a `removeWatcher`
  y el servicio y su notificación se apagan.
- Privacidad: la app no recolecta nada fuera de lo que ya hace la web: muestra el mismo aviso de la pantalla ("solo se
  comparte mientras tengas entregas en camino... no se guarda ningún recorrido, solo tu último punto"). No hay analítica ni
  otros servicios.

## Cómo funciona el envío con la pantalla apagada (y sus límites)

El servicio nativo mantiene vivo el proceso y el GPS (~1 punto por segundo). Cada punto llega al JavaScript del WebView
por el puente de Capacitor, y **ese mismo JavaScript** hace la llamada a la Server Action (con la cookie de sesión del
WebView). Elegí esto en vez de que el servicio nativo haga el POST HTTP porque (a) no hace falta un endpoint nuevo ni
guardar el token de sesión fuera del WebView, (b) la autenticación y las reglas de seguridad son exactamente las de la
web, (c) con `KeepRunning` (valor por defecto de Capacitor) la actividad en segundo plano **no pausa los timers ni el
JavaScript del WebView**, y el envío se dispara por la llegada del punto, no por un timer.

Riesgos reales, a verificar en un celular antes de dar la app por buena:

1. **Fabricantes con ahorro de batería agresivo (Xiaomi/MIUI, Samsung, Huawei, Oppo, Realme)** pueden matar la app o
   congelar el WebView aunque tenga servicio en primer plano. Hay que poner la app en batería **"Sin restricciones"** y, en
   Xiaomi, activar además "Inicio automático" y bloquear la app en recientes. La pantalla de la app lo explica.
2. **Si Android mata el proceso** (poca memoria), se corta el envío; el repartidor debe volver a abrir la app y tocar
   "Compartir" (la web ya muestra el cartel de posición "vieja" al cliente tras 3 minutos).
3. **Si en un modelo concreto el WebView frena el JavaScript con la pantalla apagada**, el síntoma es que el cliente ve la
   posición "vieja". **Plan B (no implementado)**: un `HttpURLConnection` dentro del servicio nativo que mande cada punto a
   un endpoint nuevo autenticado con un token propio del repartidor (hay que crear ese endpoint y el token, y revisar la
   seguridad). Solo conviene hacerlo si la prueba en un celular real lo muestra necesario.
4. El servicio se detiene si el repartidor sale de `/tenteo/repartos` dentro de la app (igual que en la web); dentro de esa
   pantalla puede usar todo (entregas, chat) sin problema.
5. "Permitir todo el tiempo": el plugin solo pide el permiso "mientras se usa la app"; un servicio en primer plano iniciado
   con la app abierta sigue recibiendo ubicación igual, pero algunos celulares exigen "todo el tiempo". Por eso la pantalla
   le pide al repartidor que lo elija en Ajustes (botón "Abrir ajustes de la app").

**Estado de verificación**: nada de esto se compiló ni se probó en un celular todavía (el equipo de desarrollo no tenía
Java ni Android SDK). El primer APK es una prueba: seguí la lista de "Probar antes de usarla".

## Paso a paso para el dueño

### 1. Generar la clave de firma (una sola vez; guardala bien)

Necesitás Java (`keytool`) en tu computadora, o hacelo desde Android Studio. Ejecutá:

```
keytool -genkeypair -v -keystore reparto.keystore -alias reparto -keyalg RSA -keysize 2048 -validity 10000
```

Te pide una contraseña del almacén, tus datos y la contraseña de la clave. **Guardá el archivo `reparto.keystore` y las
contraseñas en un lugar seguro (fuera del repositorio): si la perdés, no se puede actualizar la app instalada en los
celulares, hay que desinstalarla e instalar de nuevo.** Nunca la subas a Git (`.gitignore` ya ignora `*.keystore` y `*.jks`).

### 2. Cargar los Secrets en GitHub

1. Convertí la clave a texto: en Linux/Mac `base64 -w0 reparto.keystore`; en Windows (PowerShell):
   `[Convert]::ToBase64String([IO.File]::ReadAllBytes("reparto.keystore")) | Set-Clipboard`.
2. En GitHub: el repositorio > **Settings > Secrets and variables > Actions > New repository secret**. Creá estos cuatro:

| Secret | Valor |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | el texto base64 del paso anterior |
| `ANDROID_KEYSTORE_PASSWORD` | la contraseña del almacén |
| `ANDROID_KEY_ALIAS` | `reparto` (el alias que usaste) |
| `ANDROID_KEY_PASSWORD` | la contraseña de la clave |

**Sin estos secrets** el workflow igual compila, pero un APK de **debug** firmado con una clave de debug que **cambia entre
compilaciones**: sirve para probar ya, pero Android no deja actualizar encima de una instalación previa con otra firma (hay
que desinstalar y reinstalar, y se pierde la sesión). Para uso real conviene cargar los secrets antes del primer APK
definitivo. El log del workflow lo avisa con una advertencia amarilla.

### 3. Compilar el APK

- **A mano**: GitHub > pestaña **Actions** > **APK Repartidor** > **Run workflow** (rama que corresponda).
- **Con una versión**: crear y subir un tag `reparto-v1.0.0` (`git tag reparto-v1.0.0 && git push origin reparto-v1.0.0`);
  además de compilar publica el APK en **Releases**.

Tarda unos 5-10 minutos. Cada compilación tiene un número de versión creciente (el número de corrida del workflow), así
Android acepta la actualización.

### 4. Descargar el APK

- Al terminar la corrida, entrá a ella (Actions > la corrida) y abajo, en **Artifacts**, bajá `angiru-reparto-apk` (es un
  .zip con el `.apk`; se conserva 30 días).
- Si usaste un tag: GitHub > **Releases** > bajá el `.apk` directamente.
- Pasalo al celular (WhatsApp a vos mismo, Drive, cable USB).

### 5. Instalarlo en el celular Android

1. Abrí el archivo `.apk` en el celular. Android va a avisar que no deja instalar apps de ese origen: tocá **Configuración** y
   activá **"Permitir de esta fuente"** / **"Instalar apps desconocidas"** para la aplicación desde la que lo abriste
   (Archivos, Chrome, WhatsApp...). Volvé y tocá **Instalar**.
2. Si aparece "Play Protect bloqueó...", elegí **Instalar de todas formas** (la app no está en la tienda).
3. Abrila, iniciá sesión con el usuario del repartidor.

### 6. Dar el permiso de ubicación "todo el tiempo" y la batería

1. En la pantalla **Mis entregas** tocá **Compartir** y aceptá el permiso de ubicación (elegí **ubicación precisa**) y el de
   notificaciones.
2. **Ajustes del celular > Aplicaciones > Angiru Reparto > Permisos > Ubicación** (o el botón "Abrir ajustes de la app" de
   la pantalla): elegí **"Permitir todo el tiempo"** y dejá **"Usar ubicación precisa"** activado.
3. **Ajustes > Aplicaciones > Angiru Reparto > Batería**: **"Sin restricciones"** (en Samsung: "No optimizada"/sacarla de
   "Aplicaciones en suspensión"; en Xiaomi: "Sin restricciones" + "Inicio automático" activado + bloquear la app en la vista
   de recientes).

### 7. Probar antes de usarla (lista corta)

- Con un pedido de prueba en reparto, tocar **Compartir**: debe aparecer la notificación fija y el cliente ver el mapa.
- Bloquear el celular 5 minutos y mirar el seguimiento del cliente: "actualizado hace X s" debe seguir bajando a ~12 s.
- Usar otra aplicación 5 minutos y repetir.
- **Dejar de compartir** y entregar el último pedido: la notificación debe desaparecer.

### 8. Actualizar

- **Cambios en la web** (la pantalla, los pedidos): la app los toma sola, no hay que hacer nada.
- **Cambios en la app** (permisos, ícono, plugin, versión de Capacitor): volver a correr el workflow y, en cada celular,
  instalar el APK nuevo encima del anterior. Funciona **solo si está firmado con la misma clave** (por eso el paso 1).

## Para quien programe

```
cd app-repartidor
npm ci
npx cap sync android      # copia la config y los plugins a android/
npm run assets            # regenera íconos y pantalla de inicio desde assets/
```

La carpeta `android/` se versiona (es lo normal en Capacitor); no se versionan `node_modules`, `android/app/build`,
`android/.gradle` ni claves. La firma de `release` se toma de las variables de entorno `ANDROID_KEYSTORE_FILE`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (las arma el workflow). Para compilar local hace
falta JDK 17 y el Android SDK: `cd android && ./gradlew assembleDebug`.
