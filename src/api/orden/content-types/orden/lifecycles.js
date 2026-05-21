'use strict';

module.exports = {
  async afterUpdate(event) {
    const { result, params } = event;

    // Solo actuar cuando estadoOrden cambia a 'Recolectado'
    if (params.data?.estadoOrden !== 'Recolectado') return;

    // Cargar la orden con todas sus rentas
    const orden = await strapi.db.query('api::orden.orden').findOne({
      where: { id: result.id },
      populate: { rentas: true },
    });

    if (!orden?.rentas?.length) return;

    // Filtrar solo las rentas que NO están en estado final
    // Si no hay ninguna pendiente, esta llamada viene del cascade de renta/lifecycles.js
    // — salir para evitar bucle infinito
    const estadosFinales = ['devuelta', 'completada', 'danos_pendientes'];
    const rentasPendientes = orden.rentas.filter(
      (r) => !estadosFinales.includes(r.estadoRenta)
    );

    if (rentasPendientes.length === 0) return;

    // Marcar cada renta pendiente como devuelta.
    // Esto dispara renta/lifecycles.js por cada una, que se encarga de:
    //   - poner el inventario en Disponible
    //   - enviar WhatsApp al cliente cuando todas estén devueltas
    for (const renta of rentasPendientes) {
      await strapi.db.query('api::renta.renta').update({
        where: { id: renta.id },
        data: { estadoRenta: 'devuelta' },
      });
    }
  },
};
