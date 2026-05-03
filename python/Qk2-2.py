from qiskit import *
from qiskit_aer import *
import matplotlib.pyplot as plt
qc = QuantumCircuit(1)  # 1量子ビットの量子回路qcの生成
qc.x(0)  # 量子ビットq[0]のビット反転演算
qc.measure_all()  # 量子回路qcの測定
fig = qc.draw('mpl')
fig.savefig('circuit2-2.png')
be = Aer.get_backend('aer_simulator')  # エイリアスとしてAerSimulator()も使える
res = be.run(qc, shots=100).result()
print(res.get_counts(qc))
# plt.show() # DockerのようなGUIがない環境では、show()の代わりにsavefig()で画像として保存します