from qiskit import *
from qiskit_aer import *
from qiskit.visualization import circuit_drawer
import matplotlib.pyplot as pyplot
q = QuantumRegister(1, 'q0')  # 1つの量子レジスタqの生成
c = ClassicalRegister(1, 'c0')  # 1つの古典的レジスタcの生成