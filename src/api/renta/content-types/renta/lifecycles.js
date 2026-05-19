'use strict';

const N8N_WEBHOOK_URL =
  'https://alivioencasa.app.n8n.cloud/webhook/notificaciones-estado-renta';

module.exports = {
  async afterUpdate(event) {
    const { result, params } = event;

    // Solo actuar si el campo estadoRenta fue parte de la actualización
    if (!params.data?.estadoRenta) return;

    const nuevoEstado = result.estadoRenta;
    if (!['entregada', 'devuelta', 'completada', 'danos_pendientes'].includes(nuevoEstado)) return;

    // Cargar la renta completa con relaciones necesarias
    const renta = await strapi.db.query('api::renta.renta').findOne({
      where: { id: result.id },
      populate: {
        inventario: true,
        orden: {
          populate: {
            rentas: true,
            cliente: true,
          },
        },
      },
    });

    if (!renta?.orden) return;

    const orden = renta.orden;
    const cliente = orden.cliente;

    // ── DEVOLUCIÓN: restaurar inventario ────────────────────────────────────
    if (['devuelta', 'completada', 'danos_pendientes'].includes(nuevoEstado)) {
      if (renta.inventario?.id) {
        await strapi.db.query('api::inventario.inventario').update({
          where: { id: renta.inventario.id },
          data: { estadoActual: 'Disponible' },
        });
      }

      // Verificar si TODAS las rentas de la orden ya están devueltas
      // (tratamos la renta actual como ya actualizada aunque orden.rentas refleje el estado anterior)
      const todasDevueltas = orden.rentas.every((r) =>
        r.id === renta.id
          ? true
          : ['devuelta', 'completada', 'danos_pendientes'].includes(r.estadoRenta)
      );

      if (todasDevueltas) {
        await strapi.db.query('api::orden.orden').update({
          where: { id: orden.id },
          data: {
            estadoOrden: 'Recolectado',
            fechaDevolucionReal: new Date().toISOString(),
          },
        });

        // Notificar a n8n para enviar WhatsApp al cliente
        fetch(N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'devuelto',
            clienteTelefono: cliente?.telefono,
            clienteNombre: cliente?.nombre,
            ordenDocumentId: orden.documentId,
          }),
        }).catch(() => {}); // No bloquear Strapi si n8n falla
      }
    }

    // ── ENTREGA: actualizar estado de orden ─────────────────────────────────
    if (nuevoEstado === 'entregada') {
      const todasEntregadas = orden.rentas.every((r) =>
        r.id === renta.id ? true : r.estadoRenta === 'entregada'
      );

      if (todasEntregadas) {
        await strapi.db.query('api::orden.orden').update({
          where: { id: orden.id },
          data: { estadoOrden: 'Entregado' },
        });

        fetch(N8N_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'entregado',
            clienteTelefono: cliente?.telefono,
            clienteNombre: cliente?.nombre,
            ordenDocumentId: orden.documentId,
          }),
        }).catch(() => {});
      }
    }
  },
};
