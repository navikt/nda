import type { ChartData, ChartOptions } from 'chart.js'
import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Title, Tooltip } from 'chart.js'
import { useCallback, useMemo, useRef } from 'react'
import { Bar } from 'react-chartjs-2'
import type { DeploymentCategory } from '~/db/deployment-categories'
import type { DeployerMonthlyStats } from '~/db/deployments.server'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

function formatMonthLabel(month: string): string {
  const [year, m] = month.split('-')
  const months = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des']
  return `${months[Number(m) - 1]} ${year}`
}

const DATASET_CATEGORY_MAP: DeploymentCategory[] = ['with_goal', 'without_goal', 'dependabot']

interface Props {
  data: DeployerMonthlyStats[]
  visibleCategories?: DeploymentCategory[]
  onToggleCategory?: (category: DeploymentCategory) => void
}

export function DeploymentActivityChart({ data, visibleCategories, onToggleCategory }: Props) {
  const chartRef = useRef<ChartJS<'bar'>>(null)

  const chartData = useMemo((): ChartData<'bar'> => {
    const labels = data.map((d) => d.month)
    const allVisible = !visibleCategories || visibleCategories.length === 3

    return {
      labels,
      datasets: [
        {
          label: 'Med endringsopphav',
          data: data.map((d) => d.with_goal),
          backgroundColor: 'rgba(51, 170, 95, 0.7)',
          borderColor: 'rgba(51, 170, 95, 1)',
          borderWidth: 1,
          hidden: !allVisible && !visibleCategories?.includes('with_goal'),
        },
        {
          label: 'Uten endringsopphav',
          data: data.map((d) => d.without_goal),
          backgroundColor: 'rgba(255, 181, 46, 0.7)',
          borderColor: 'rgba(255, 181, 46, 1)',
          borderWidth: 1,
          hidden: !allVisible && !visibleCategories?.includes('without_goal'),
        },
        {
          label: 'Dependabot',
          data: data.map((d) => d.dependabot),
          backgroundColor: 'rgba(130, 150, 180, 0.7)',
          borderColor: 'rgba(130, 150, 180, 1)',
          borderWidth: 1,
          hidden: !allVisible && !visibleCategories?.includes('dependabot'),
        },
      ],
    }
  }, [data, visibleCategories])

  const handleLegendClick = useCallback(
    (_e: unknown, legendItem: { datasetIndex?: number }) => {
      if (!onToggleCategory || legendItem.datasetIndex == null) return
      const category = DATASET_CATEGORY_MAP[legendItem.datasetIndex]
      if (category) {
        onToggleCategory(category)
      }
    },
    [onToggleCategory],
  )

  const options = useMemo(
    (): ChartOptions<'bar'> => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: false },
        legend: {
          display: true,
          position: 'top' as const,
          ...(onToggleCategory ? { onClick: handleLegendClick } : {}),
        },
        tooltip: {
          mode: 'index' as const,
          intersect: false,
          callbacks: {
            title: (items) => formatMonthLabel(items[0]?.label ?? ''),
            footer: (items) => {
              const total = items.reduce((sum, item) => sum + (item.parsed.y ?? 0), 0)
              return `Totalt: ${total}`
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          ticks: {
            callback: function (value) {
              return formatMonthLabel(this.getLabelForValue(value as number))
            },
            maxTicksLimit: 12,
          },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: {
            precision: 0,
          },
        },
      },
    }),
    [onToggleCategory, handleLegendClick],
  )

  if (data.length === 0) {
    return null
  }

  return (
    <div style={{ height: '250px', position: 'relative' }} role="img" aria-label="Leveranser over tid">
      <Bar ref={chartRef} options={options} data={chartData} />
    </div>
  )
}
