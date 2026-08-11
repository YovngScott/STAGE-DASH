# Operación de producción de Stage

## Flujo del dueño

### Bots

1. En **Bot Builder**, elegir canal y función, y completar solo la información específica del negocio.
2. Stage combina esa información con las restricciones, herramientas y comportamiento seguros del backend.
3. **Crear bot** guarda un borrador y abre el **Centro de Calidad**; no crea una máquina.
4. Ejecutar las pruebas obligatorias y las preguntas manuales.
5. **Publicar** crea o actualiza GitHub, Supabase, secretos, Fly, health checks y punto de rollback.

No se mantienen dos bots públicos únicamente para pruebas. El laboratorio de borradores del Centro de Calidad ejecuta el mismo motor con acciones simuladas y sin canales reales; evita mensajes accidentales y máquinas innecesarias.

### Aplicaciones web

1. Crear el cliente en Client Manager.
2. Abrir **Web Apps** y pulsar **Replicar para nuevo cliente**.
3. Elegir la plantilla y completar identidad, contacto, marca, texto legal y PIN inicial.
4. Stage verifica capacidad antes de mutar recursos.
5. Si el preflight pasa, crea repositorio privado, proyecto Supabase aislado, migraciones, usuario administrador, secretos, Fly, health check y registro de acceso.

La plantilla estándar está en `YovngScott/stage-template-workshop` y está marcada como GitHub Template. Su `stage-template.json` define campos, módulos, secretos, migraciones, buckets, pruebas y compatibilidad.

## Controles ya activos

- Cola durable en Supabase con leasing entre workers, reintentos, deduplicación, métricas e intervención manual.
- Horarios por tenant: zona horaria, días laborables, horario comercial, silencio, feriados y reporte individual.
- WhatsApp mediante adaptador: QR/Baileys para piloto o Meta Cloud API para cuentas críticas.
- Cuatro pruebas obligatorias de aislamiento multi-tenant en el Centro de Calidad.
- Configuración de bot con borrador, pruebas, publicación, versiones, rollback, backups y simulacro de restauración.
- Plantilla web que falla cerrada en producción, RLS restrictivo, CSP, límites de solicitud, rate limit y secretos solo del lado servidor.
- Fly con auto-stop y cero máquinas mínimas para aplicaciones web replicadas.

## Capacidad y bloqueo actual

La organización **STAGE AI LABS LLC** usa Supabase Free y tiene 2/2 proyectos activos. El Owner Console muestra esta condición y bloquea una réplica antes de crear repositorios, proyectos o máquinas huérfanas.

Para publicar el taller piloto y el segundo cliente ficticio se debe liberar un proyecto no productivo o activar Supabase Pro. No se debe reutilizar una base de bots o del Owner Console: rompería el aislamiento esperado.

## Secretos y rotación

- El token de Supabase Management está en Fly, no en GitHub ni en formularios.
- Vence el **9 de agosto de 2027** y su fecha se expone como estado, nunca su valor.
- Las llaves de cada proyecto y el PIN inicial se transmiten solo durante el aprovisionamiento.
- Groq, Meta, Brevo y otros proveedores conservan secretos por plataforma o por cliente según el nivel elegido.

## Recuperación

- Configuración de bot: restaurar una versión desde Centro de Calidad y publicar.
- Operaciones fallidas: revisar la bandeja central, reintentar o resolver manualmente.
- Aplicación web: usar rollback desde Web Apps cuando exista una versión anterior.
- Base de datos: verificar backups del proyecto Supabase y realizar un simulacro periódico antes de cada lanzamiento importante.
- Sesión WhatsApp QR: reconectar desde frontend; para clientes críticos usar Meta Cloud API.

## Verificación ejecutada el 11 de agosto de 2026

- Backend de bots: 16/16 pruebas aprobadas.
- Plantilla de taller: manifiesto, 50 migraciones y límites de producción aprobados; build aprobado.
- Servidor de plantilla: `/api/health` y configuración dinámica aprobados.
- Fábrica web: autenticación de dueño aprobada, plantilla visible y preflight de capacidad aprobado.
- Preflight ficticio: bloqueado sin insertar despliegues; cero recursos huérfanos.
- Owner Console: build y despliegue Fly aprobados; health check 1/1.
