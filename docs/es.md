# Invoice Ninja

Siga su facturación desde Gladys: las facturas impagadas y vencidas, el dinero cobrado este mes y los
presupuestos pendientes de su [Invoice Ninja](https://invoiceninja.com), autoalojado o en el servicio alojado
invoicing.co. Reciba un aviso cuando llega un pago, cuando una factura vence o cuando un cliente acepta un
presupuesto.

La integración solo lee: nunca escribe en sus facturas, no envía ningún correo, no crea nada. Consulta la API de
Invoice Ninja con un token que usted crea. Sin afiliación con Invoice Ninja.

## Lo que obtiene

- Un **dispositivo para su empresa**: facturas impagadas (número e importe), facturas vencidas (número e
  importe), dinero cobrado este mes y presupuestos pendientes, con su historial.
- Un **widget del panel**: las facturas vencidas con sus días de retraso, los últimos pagos y los totales; cada
  bloque y los importes se pueden ocultar.
- Tres **disparadores de escena**: pago recibido, factura vencida, presupuesto aceptado.
- Una **acción de escena**: un resumen en una frase para enviar por mensaje o leer en voz alta, y sus cifras.

## Requisitos

- Gladys Assistant 5.1 o posterior.
- Invoice Ninja 5 (probado con la 5.13 autoalojada), accesible desde el equipo de Gladys, o una cuenta en
  invoicing.co. Invoice Ninja 4 tiene otra API y no es compatible.
- Un token de API de la empresa que desea seguir. En invoicing.co, compruebe que su plan incluye la API.

Probado con un Invoice Ninja 5.13 autoalojado real con clientes, facturas, pagos y presupuestos ficticios; no
probado en invoicing.co: sus comentarios son bienvenidos.

## Configuración

### Crear un token de API

En Invoice Ninja, abra **Ajustes → Gestión de la cuenta → Tokens de API** y luego **Nuevo token**. Dele un nombre
(por ejemplo «Gladys»), guarde y copie el token mostrado. Un token pertenece a una empresa: si tiene varias,
créelo con la empresa que desea seguir seleccionada.

### Ajustes

| Ajuste                     | Función                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| Dirección de Invoice Ninja | La dirección con la que abre Invoice Ninja, p. ej. `https://facturas.example.com`           |
| Token de API               | El token creado arriba. Guardado por Gladys, nunca escrito en los registros                 |
| Intervalo de actualización | Frecuencia de lectura de Invoice Ninja: de 5 a 60 minutos, 15 por defecto                   |
| Idioma de los textos       | Nombres de las funciones (al crearlas) y frases enviadas a las escenas; francés por defecto |

Para el servicio alojado, la dirección es `https://invoicing.co`. Pulse **Probar la conexión**: la respuesta
indica cuántas facturas impagadas, facturas vencidas y presupuestos pendientes se encontraron, o qué falla. Abra
después la pestaña **Descubrir** y añada la empresa.

## Dispositivo

| Función                 | Significado                                                               |
| ----------------------- | ------------------------------------------------------------------------- |
| Facturas impagadas      | Facturas enviadas o pagadas en parte con saldo pendiente                  |
| Importe impagado        | La suma de sus saldos                                                     |
| Facturas vencidas       | Aquellas cuyo vencimiento (o el vencimiento de su pago parcial) ha pasado |
| Importe vencido         | La suma de sus saldos                                                     |
| Cobrado este mes        | Los pagos con fecha de este mes, descontados los reembolsos               |
| Presupuestos pendientes | Los presupuestos enviados, ni aceptados ni caducados                      |

Los borradores, las facturas anuladas o eliminadas y los datos de los clientes eliminados se dejan fuera, como en
el panel de Invoice Ninja. Los importes están en la divisa de la empresa: una factura o un pago en otra divisa se
convierte con el tipo de cambio que Invoice Ninja registró en él. El euro, el dólar estadounidense y la libra
esterlina se muestran con su símbolo en Gladys; otra divisa se escribe después del nombre del dispositivo. Una
factura está vencida el día siguiente a su vencimiento, en la zona horaria de Gladys.

## Widget del panel

Añada el widget **Resumen de Invoice Ninja** a un panel. Muestra cuatro mosaicos (facturas vencidas, importe
vencido, importe impagado, cobrado este mes), las facturas vencidas con su cliente, vencimiento, saldo y días de
retraso (5 como máximo, las más antiguas primero) y los últimos pagos (5 como máximo). Sus ajustes ocultan los
importes (solo quedan cantidades y fechas, para un panel que ve todo el mundo), los mosaicos, las facturas
vencidas o los pagos. Funciona en cuanto la integración lee Invoice Ninja, incluso antes de añadir el
dispositivo.

## Disparadores de escena

| Disparador           | Cuándo                                                               | Variables                                                                                  |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Pago recibido        | Se registra un nuevo pago completado, a mano o mediante una pasarela | cliente, importe, divisa, número del pago, fecha, frase                                    |
| Factura vencida      | Una factura impagada supera su vencimiento                           | número de factura, cliente, importe pendiente, divisa, vencimiento, días de retraso, frase |
| Presupuesto aceptado | Un presupuesto es aprobado por el cliente o convertido en factura    | número del presupuesto, cliente, importe, divisa, frase                                    |

Lo que existe en la primera lectura es el punto de partida: instalar la integración no dispara nada por los pagos
pasados ni por las facturas ya vencidas. Cada evento se envía una vez; una factura saldada que vuelve a vencer más
tarde dispara de nuevo. Lo ya avisado se guarda en los datos de la integración: un reinicio no dispara nada dos
veces. Un evento se detecta en la lectura siguiente, es decir, hasta un intervalo de actualización más tarde.

## Acción de escena

**Invoice Ninja: leer el resumen** responde una frase como «3 factura(s) impagada(s) por 3.980,50 €, 2
vencida(s) por 1.480,50 €. Cobrado este mes: 500,00 €. 4 presupuesto(s) pendiente(s).» y las mismas cifras como
salidas separadas. Vuelve a leer Invoice Ninja si la última lectura tiene más de un intervalo de actualización.
Cuando el servidor no responde, se usan los últimos valores.

## Ejemplos de escenas

- **Llega un pago**: disparador «Invoice Ninja: pago recibido», luego «Enviar un mensaje» con la variable _Frase
  para enviar o leer_.
- **Lunes por la mañana**: cada lunes a las 8:00, «Invoice Ninja: leer el resumen», luego envíe su frase por
  mensaje o haga que un altavoz la lea.
- **Recordatorio**: disparador «Invoice Ninja: factura vencida», luego un mensaje «Recordar al cliente» con el
  número de factura y el cliente.
- **Buena noticia**: disparador «Invoice Ninja: presupuesto aceptado», luego una lámpara en verde durante un
  minuto.

## Privacidad y datos

- El token se queda en la configuración de Gladys; la integración solo lo envía a la dirección que usted indicó.
- Los registros de la integración nunca contienen un importe, un nombre de cliente, el token ni la dirección: solo
  cantidades, códigos de error y números de factura.
- Guardado en el volumen `/data` de la integración: los identificadores de los pagos, facturas vencidas y
  presupuestos aceptados ya avisados, y el identificador de la empresa. Ningún importe, ningún nombre.
- Los nombres de los clientes y los importes los muestra el widget y los reciben las escenas que usted crea, solo
  dentro de Gladys.

## Solución de problemas

| Mensaje                                         | Qué hacer                                                                                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invoice Ninja rechaza el token de API           | Cree un token nuevo, cópielo entero, compruebe que pertenece a la empresa correcta                                                                         |
| No hay API de Invoice Ninja 5 en esta dirección | Indique la dirección con la que abre Invoice Ninja, sin `/api/v1`; Invoice Ninja 4 no es compatible                                                        |
| Invoice Ninja no responde                       | Compruebe que el equipo de Gladys llega a la dirección (red, VPN, cortafuegos, certificado HTTPS)                                                          |
| La dirección de Invoice Ninja redirige a otra   | Indique la dirección a la que llega el navegador, a menudo con `https://`: las redirecciones nunca se siguen, así que el token nunca se envía a otro sitio |
| Invoice Ninja limita las solicitudes            | Elija un intervalo de actualización más largo                                                                                                              |
| Invoice Ninja responde con un error             | Consulte los registros de Invoice Ninja; mientras tanto se conservan los últimos valores                                                                   |

El detalle de cada lectura se escribe en los registros con `LOG_LEVEL=debug`.

## Límites

- Una empresa por token: para varias empresas hace falta un token por empresa, y una instalación sigue una
  empresa.
- Cada lectura hace seis solicitudes a Invoice Ninja (más a partir de 100 facturas impagadas o pagos en el mes);
  el servicio alojado limita su API, así que mantenga un intervalo razonable.
- Un pago registrado como pendiente (transferencia por confirmar) y completado más tarde, después de más de 10
  pagos nuevos, no se avisa.
- El ajuste «Preferir la conexión local» de Gladys no tiene efecto: solo hay una dirección. El dispositivo indica
  «local» para un servidor autoalojado y «nube» para invoicing.co.
- Solo lectura: no se puede crear, enviar ni marcar como pagada ninguna factura desde Gladys.
