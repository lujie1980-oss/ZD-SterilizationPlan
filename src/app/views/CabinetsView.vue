<script setup lang="ts">
import { CABINETS, traysForCabinet } from '../../data/seed-cabinets';
</script>

<template>
  <section id="page-cabinets">
    <div class="card">
      <div class="card-header">
        <span>灭菌柜主数据（子集演示）</span>
        <span class="hint">柜21 以「待确认」状态参与日排产可选 · 报废不可选</span>
      </div>
      <div class="card-body table-wrap" style="padding:0">
        <table class="data">
          <thead>
            <tr>
              <th>柜号</th><th>规范码</th><th>基地</th><th>额定装载</th><th>日产能</th><th>托盘层</th><th>状态</th><th>备注</th><th>关联工艺</th>
            </tr>
          </thead>
          <tbody id="cabBody">
            <tr v-for="c in CABINETS" :key="c.id">
              <td><strong>{{ c.displayCode }}</strong></td>
              <td class="mono">{{ c.canonicalId }}</td>
              <td>{{ c.base }}基地</td>
              <td>{{ c.ratedLoadM3 }} m³</td>
              <td>{{ c.capacity }} m³</td>
              <td>{{ traysForCabinet(c.id).length }} 层</td>
              <td>
                <span v-if="c.status === '可用'" class="tag tag-green">可用</span>
                <span v-else-if="c.status === '报废'" class="tag tag-red">报废</span>
                <span v-else class="tag tag-pending">待确认·未进产能主数据</span>
              </td>
              <td>{{ c.note || '—' }}</td>
              <td>
                <span v-for="t in c.tags" :key="t" class="tag tag-blue">{{ t }}</span>
                <template v-if="!c.tags.length">—</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
